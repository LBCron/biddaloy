import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, EntityManager } from 'typeorm';
import { AuditAction, ExamComponentKind, ExamComponentSource, ExamStatus } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { ResultsService, examPublished } from './results.service';
import { lockExam } from './exam-lock';
import { Subject } from '../academics/entities/subject.entity';
import {
  CreateExamComponentDto,
  UpdateExamComponentDto,
  CopyExamComponentsDto,
} from './dto/exams.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';

export interface CopyComponentsResult {
  copied: { subject_id: string; name: string }[];
  skipped: { subject_id: string; name: string; reason: string }[];
}

@Injectable()
export class ExamComponentsService {
  constructor(
    @InjectRepository(Exam)
    private readonly examRepo: Repository<Exam>,
    @InjectRepository(ExamComponent)
    private readonly repo: Repository<ExamComponent>,
    @InjectRepository(Subject)
    private readonly subjectRepo: Repository<Subject>,
    private readonly auditService: AuditService,
    private readonly resultsService: ResultsService,
  ) {}

  private async findExam(examId: string, tenantId: string): Promise<Exam> {
    const exam = await this.examRepo.findOne({
      where: { id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!exam) {
      throw new NotFoundException('Exam not found');
    }
    return exam;
  }

  /** [ACAD-05] Locks the exam row and refuses edits once results are
   * published — reopening (step-up approved, audited) is the only way back. */
  private async lockEditableExam(
    manager: EntityManager,
    examId: string,
    tenantId: string,
  ): Promise<Exam> {
    const exam = await lockExam(manager, examId, tenantId);
    if (exam.status === ExamStatus.PUBLISHED) throw examPublished();
    return exam;
  }

  /** A PROCESSED exam's stored results go stale on any part change, so they
   * are rewritten in the same transaction (a failure rolls the edit back). */
  private async recomputeIfProcessed(
    manager: EntityManager,
    exam: Exam,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<void> {
    if (exam.status === ExamStatus.PROCESSED) {
      await this.resultsService.recomputeProcessedExam(manager, exam.id, tenantId, userId, context);
    }
  }

  /** A new MANUAL part on a PROCESSED exam has no marks yet. Recomputing
   * would store it as ABSENT for everyone, ready to publish, so the exam
   * goes back to DRAFT instead: it must be processed again, and process()
   * refuses while the new cells are blank (unless forced, audited). */
  private async afterPartsAdded(
    manager: EntityManager,
    exam: Exam,
    addedManual: boolean,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<void> {
    if (!addedManual || exam.status !== ExamStatus.PROCESSED) {
      await this.recomputeIfProcessed(manager, exam, tenantId, userId, context);
      return;
    }
    await manager
      .getRepository(Exam)
      .update({ id: exam.id, tenant_id: tenantId }, { status: ExamStatus.DRAFT });
    await this.auditService.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'Exam',
        entity_id: exam.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: context.ip,
        user_agent: context.userAgent,
        old_values: { status: ExamStatus.PROCESSED },
        new_values: { status: ExamStatus.DRAFT, reason: 'COMPONENT_ADDED' },
      },
      manager,
    );
  }

  /** IDOR guard: a component's `subject_id` must belong to the caller's
   * own tenant — the migration's FK is single-column and doesn't itself
   * enforce that. */
  private async assertSubjectBelongsToTenant(subjectId: string, tenantId: string): Promise<void> {
    const subject = await this.subjectRepo.findOne({
      where: { id: subjectId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!subject) {
      throw new BadRequestException('Subject not found for this tenant.');
    }
  }

  /** Shared validation for create/update/copy (issue rules #2 and #5):
   * `pass_marks <= full_marks`, `sequence` unique within exam-subject, and
   * an ATTENDANCE-kind component must be DERIVED with at most one per
   * exam-subject. `excludeId` skips the row being updated when checking
   * uniqueness against itself. */
  private async validate(
    manager: EntityManager,
    examId: string,
    subjectId: string,
    tenantId: string,
    values: {
      name: string;
      kind: ExamComponentKind;
      source: ExamComponentSource;
      full_marks: string;
      pass_marks: string | null;
      sequence: number;
    },
    excludeId?: string,
  ): Promise<void> {
    if (values.pass_marks !== null && Number(values.pass_marks) > Number(values.full_marks)) {
      throw new BadRequestException('pass_marks cannot exceed full_marks.');
    }

    if (
      values.kind === ExamComponentKind.ATTENDANCE &&
      values.source !== ExamComponentSource.DERIVED
    ) {
      throw new BadRequestException('An ATTENDANCE component must have source = DERIVED.');
    }

    const existing = await manager.getRepository(ExamComponent).find({
      where: { exam_id: examId, subject_id: subjectId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    const others = existing.filter((c) => c.id !== excludeId);

    // Mirrors IDX_exam_components_exam_subject_name — checked here too so
    // create/update 409 with a clear message instead of reaching the DB
    // and failing with an unmapped 23505 (the copy() method already has
    // this check; create/update didn't).
    if (others.some((c) => c.name === values.name)) {
      throw new ConflictException(
        'A component with this name already exists for this exam-subject.',
      );
    }

    if (others.some((c) => c.sequence === values.sequence)) {
      throw new ConflictException(
        'This sequence is already used by another component of this exam-subject.',
      );
    }

    if (
      values.kind === ExamComponentKind.ATTENDANCE &&
      others.some((c) => c.kind === ExamComponentKind.ATTENDANCE)
    ) {
      throw new ConflictException(
        'This exam-subject already has an ATTENDANCE component — only one is allowed.',
      );
    }
  }

  async create(
    examId: string,
    dto: CreateExamComponentDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ExamComponent> {
    await this.findExam(examId, tenantId);
    await this.assertSubjectBelongsToTenant(dto.subject_id, tenantId);
    const source = dto.source ?? ExamComponentSource.MANUAL;

    return this.repo.manager.transaction(async (manager) => {
      const exam = await this.lockEditableExam(manager, examId, tenantId);
      await this.validate(manager, examId, dto.subject_id, tenantId, {
        name: dto.name,
        kind: dto.kind,
        source,
        full_marks: dto.full_marks,
        pass_marks: dto.pass_marks ?? null,
        sequence: dto.sequence,
      });
      const repo = manager.getRepository(ExamComponent);
      const entity = repo.create({
        exam_id: examId,
        subject_id: dto.subject_id,
        name: dto.name,
        kind: dto.kind,
        source,
        full_marks: dto.full_marks,
        pass_marks: dto.pass_marks ?? null,
        sequence: dto.sequence,
        tenant_id: tenantId,
      });
      const saved = await repo.save(entity);

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'ExamComponent',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: null,
          new_values: { name: saved.name, kind: saved.kind, subject_id: saved.subject_id },
        },
        manager,
      );

      await this.afterPartsAdded(
        manager,
        exam,
        source === ExamComponentSource.MANUAL,
        tenantId,
        userId,
        context,
      );
      return saved;
    });
  }

  async findAll(
    examId: string,
    subjectId: string | undefined,
    tenantId: string,
  ): Promise<ExamComponent[]> {
    await this.findExam(examId, tenantId);
    const where: any = { exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() };
    if (subjectId) where.subject_id = subjectId;
    return this.repo.find({ where, order: { sequence: 'ASC' } });
  }

  async findOne(examId: string, id: string, tenantId: string): Promise<ExamComponent> {
    await this.findExam(examId, tenantId);
    const entity = await this.repo.findOne({
      where: { id, exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException('Exam component not found');
    }
    return entity;
  }

  async update(
    examId: string,
    id: string,
    dto: UpdateExamComponentDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ExamComponent> {
    await this.findOne(examId, id, tenantId);

    const changedKeys = Object.keys(dto);
    await this.repo.manager.transaction(async (manager) => {
      const exam = await this.lockEditableExam(manager, examId, tenantId);
      // Re-read under the exam lock: a concurrent edit that committed since
      // the 404 check above must be what this one validates and audits against.
      const existing = await manager.getRepository(ExamComponent).findOne({
        where: { id, exam_id: examId, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!existing) throw new NotFoundException('Exam component not found');

      await this.validate(
        manager,
        examId,
        existing.subject_id,
        tenantId,
        {
          name: dto.name ?? existing.name,
          kind: dto.kind ?? existing.kind,
          source: dto.source ?? existing.source,
          full_marks: dto.full_marks ?? existing.full_marks,
          pass_marks: dto.pass_marks !== undefined ? dto.pass_marks : existing.pass_marks,
          sequence: dto.sequence ?? existing.sequence,
        },
        id,
      );

      // [ACAD-05] full_marks can never drop below a mark already entered
      // (report cards would read 24/20). Checked under the exam lock.
      if (dto.full_marks !== undefined) {
        const row = await manager
          .getRepository(Mark)
          .createQueryBuilder('m')
          .select('MAX(m.value)', 'max')
          .where('m.component_id = :id', { id })
          .andWhere('m.tenant_id = :tenantId', { tenantId })
          .getRawOne<{ max: string | null }>();
        if (row?.max != null && Number(row.max) > Number(dto.full_marks)) {
          throw new BadRequestException({
            message: `full_marks (${dto.full_marks}) is below a mark already entered (${row.max}).`,
            details: { code: 'FULL_MARKS_BELOW_ENTERED' },
          });
        }
      }

      if (changedKeys.length === 0) return;
      const repo = manager.getRepository(ExamComponent);
      const oldValues = Object.fromEntries(changedKeys.map((key) => [key, (existing as any)[key]]));

      await repo.update({ id, exam_id: examId, tenant_id: tenantId }, dto);

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'ExamComponent',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: oldValues,
          new_values: { ...dto },
        },
        manager,
      );

      await this.recomputeIfProcessed(manager, exam, tenantId, userId, context);
    });

    return this.findOne(examId, id, tenantId);
  }

  async remove(
    examId: string,
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const existing = await this.findOne(examId, id, tenantId);

    await this.repo.manager.transaction(async (manager) => {
      const exam = await this.lockEditableExam(manager, examId, tenantId);
      const repo = manager.getRepository(ExamComponent);
      await repo.softDelete({ id, exam_id: examId, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'ExamComponent',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { name: existing.name },
          new_values: null,
        },
        manager,
      );

      await this.recomputeIfProcessed(manager, exam, tenantId, userId, context);
    });
  }

  /**
   * Additive copy (issue rule #3): copies every component from
   * (`source_exam_id`, `source_subject_id`) into each of `target_subject_ids`
   * within `examId`. Never overwrites — a target subject that already has a
   * component of the same name is skipped and reported, not merged. Sequence
   * is reassigned per target (source sequence isn't reused) so the copy
   * never collides with a target's own existing sequence.
   */
  async copy(
    examId: string,
    dto: CopyExamComponentsDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<CopyComponentsResult> {
    await this.findExam(examId, tenantId);
    // The source exam only needs to belong to the same tenant — it may be
    // this exam (copying across subjects) or a different one (copying
    // across exams), see the issue's "source = another subject in the
    // same exam, or the same subject in another exam".
    await this.findExam(dto.source_exam_id, tenantId);

    // IDOR guard: every target must belong to this tenant, checked before
    // the loop starts rather than inside it — a bad id fails the whole
    // call up front instead of copying into some tenant-owned targets and
    // silently skipping (or writing into) one that isn't.
    const targetSubjects = await this.subjectRepo.find({
      where: { id: In(dto.target_subject_ids), tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (targetSubjects.length !== dto.target_subject_ids.length) {
      throw new BadRequestException('One or more subjects not found for this tenant');
    }

    const result: CopyComponentsResult = { copied: [], skipped: [] };
    let copiedManual = false;
    await this.repo.manager.transaction(async (manager) => {
      const exam = await this.lockEditableExam(manager, examId, tenantId);
      const repo = manager.getRepository(ExamComponent);
      const sourceComponents = await repo.find({
        where: {
          exam_id: dto.source_exam_id,
          subject_id: dto.source_subject_id,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
        order: { sequence: 'ASC' },
      });

      for (const targetSubjectId of dto.target_subject_ids) {
        const existingTarget = await repo.find({
          where: {
            exam_id: examId,
            subject_id: targetSubjectId,
            tenant_id: tenantId,
            deleted_at: IsNull(),
          },
        });
        const existingNames = new Set(existingTarget.map((c) => c.name));
        let nextSequence = existingTarget.reduce((max, c) => Math.max(max, c.sequence), 0) + 1;
        let attendanceAlready = existingTarget.some((c) => c.kind === ExamComponentKind.ATTENDANCE);

        for (const source of sourceComponents) {
          if (existingNames.has(source.name)) {
            result.skipped.push({
              subject_id: targetSubjectId,
              name: source.name,
              reason: 'A component with this name already exists for this exam-subject.',
            });
            continue;
          }
          if (source.kind === ExamComponentKind.ATTENDANCE && attendanceAlready) {
            result.skipped.push({
              subject_id: targetSubjectId,
              name: source.name,
              reason: 'This exam-subject already has an ATTENDANCE component.',
            });
            continue;
          }

          {
            const entity = repo.create({
              exam_id: examId,
              subject_id: targetSubjectId,
              name: source.name,
              kind: source.kind,
              source: source.source,
              full_marks: source.full_marks,
              pass_marks: source.pass_marks,
              sequence: nextSequence,
              tenant_id: tenantId,
            });
            const saved = await repo.save(entity);

            await this.auditService.record(
              {
                action: AuditAction.CREATE,
                entity_type: 'ExamComponent',
                entity_id: saved.id,
                tenant_id: tenantId,
                performed_by_user_id: userId,
                ip_address: context.ip,
                user_agent: context.userAgent,
                old_values: null,
                new_values: {
                  name: saved.name,
                  kind: saved.kind,
                  subject_id: saved.subject_id,
                  copied_from: source.id,
                },
              },
              manager,
            );
          }

          existingNames.add(source.name);
          if (source.source === ExamComponentSource.MANUAL) copiedManual = true;
          if (source.kind === ExamComponentKind.ATTENDANCE) attendanceAlready = true;
          nextSequence += 1;
          result.copied.push({ subject_id: targetSubjectId, name: source.name });
        }
      }
      if (result.copied.length > 0) {
        await this.afterPartsAdded(manager, exam, copiedManual, tenantId, userId, context);
      }
    });

    return result;
  }
}
