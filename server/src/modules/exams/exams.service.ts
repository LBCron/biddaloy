import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, QueryFailedError, EntityManager } from 'typeorm';
import { AuditAction, ExamComponentKind, ExamComponentSource, ExamStatus } from '@biddaloy/shared';
import { Exam } from './entities/exam.entity';
import { Mark } from './entities/mark.entity';
import { Result } from './entities/result.entity';
import { ResultsService, examPublished } from './results.service';
import { lockExam } from './exam-lock';
import { ExamComponent } from './entities/exam-component.entity';
import { ExamTemplate } from './entities/exam-template.entity';
import { ExamTemplatesService } from './exam-templates.service';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { CreateExamDto, UpdateExamDto, QueryExamDto } from './dto/exams.dto';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { assertNoLiveDependents } from '../../common/utils/live-dependents';

/** Postgres unique-violation code — used to turn a race-condition insert
 * conflict into a 409 instead of letting it fall through to a raw 500. */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as any).code === PG_UNIQUE_VIOLATION;
}

@Injectable()
export class ExamsService {
  constructor(
    @InjectRepository(Exam)
    private readonly repo: Repository<Exam>,
    @InjectRepository(Mark)
    private readonly markRepo: Repository<Mark>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(AcademicYear)
    private readonly yearRepo: Repository<AcademicYear>,
    @InjectRepository(AcademicTerm)
    private readonly termRepo: Repository<AcademicTerm>,
    private readonly auditService: AuditService,
    private readonly templatesService: ExamTemplatesService,
    private readonly resultsService: ResultsService,
  ) {}

  /** IDOR guard: every client-supplied foreign key on an Exam must belong
   * to the caller's own tenant, and a class must belong to the given
   * year, and a term (if any) must belong to that same year — the
   * migration's FKs are single-column and don't themselves enforce
   * tenant or cross-reference consistency. */
  private async assertReferencesBelongToTenant(
    tenantId: string,
    refs: { classId: string; academicYearId: string; academicTermId?: string | null },
  ): Promise<void> {
    const cls = await this.classRepo.findOne({
      where: { id: refs.classId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!cls) {
      throw new BadRequestException('Class not found for this tenant.');
    }
    if (cls.academic_year_id !== refs.academicYearId) {
      throw new BadRequestException('This class does not belong to the chosen academic year.');
    }

    const year = await this.yearRepo.findOne({
      where: { id: refs.academicYearId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!year) {
      throw new BadRequestException('Academic year not found for this tenant.');
    }

    if (refs.academicTermId) {
      const term = await this.termRepo.findOne({
        where: {
          id: refs.academicTermId,
          tenant_id: tenantId,
          academic_year_id: refs.academicYearId,
          deleted_at: IsNull(),
        },
      });
      if (!term) {
        throw new BadRequestException('Academic term not found for this tenant/year.');
      }
    }
  }

  async create(
    dto: CreateExamDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Exam & { components_created: number }> {
    await this.assertReferencesBelongToTenant(tenantId, {
      classId: dto.class_id,
      academicYearId: dto.academic_year_id,
      academicTermId: dto.academic_term_id,
    });

    // Template checks run before any write, so a bad template leaves no exam row.
    let numericGrade = 0;
    if (dto.template_id) {
      const template = await this.repo.manager.getRepository(ExamTemplate).findOne({
        where: { id: dto.template_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!template) {
        throw new NotFoundException('Exam template not found');
      }
      const cls = await this.classRepo.findOne({
        where: { id: dto.class_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (cls?.numeric_grade == null) {
        throw new BadRequestException({
          message: 'This class has no grade set, so an exam structure cannot be used.',
          details: { code: 'CLASS_HAS_NO_GRADE' },
        });
      }
      numericGrade = cls.numeric_grade;
    }

    try {
      return await this.repo.manager.transaction(async (manager) => {
        const repo = manager.getRepository(Exam);
        const entity = repo.create({
          name: dto.name,
          kind: dto.kind,
          academic_year_id: dto.academic_year_id,
          class_id: dto.class_id,
          academic_term_id: dto.academic_term_id ?? null,
          mark_entry_deadline: dto.mark_entry_deadline ?? null,
          tenant_id: tenantId,
        });
        const saved = await repo.save(entity);

        const componentsCreated = dto.template_id
          ? await this.copyTemplateComponents(
              manager,
              tenantId,
              saved,
              dto.template_id,
              numericGrade,
            )
          : 0;

        await this.auditService.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'Exam',
            entity_id: saved.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: null,
            new_values: {
              name: saved.name,
              kind: saved.kind,
              academic_year_id: saved.academic_year_id,
              class_id: saved.class_id,
              ...(dto.template_id
                ? { template_id: dto.template_id, components_created: componentsCreated }
                : {}),
            },
          },
          manager,
        );

        return Object.assign(saved, { components_created: componentsCreated });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'An exam with this name already exists for this class and academic year.',
          details: { code: 'EXAM_NAME_TAKEN' },
        });
      }
      throw err;
    }
  }

  /** Copies the template's rows for the class's grade onto `exam`, inside the
   * caller's transaction. Subjects the class does not offer are skipped. */
  private async copyTemplateComponents(
    manager: EntityManager,
    tenantId: string,
    exam: Exam,
    templateId: string,
    numericGrade: number,
  ): Promise<number> {
    const offered = await manager
      .getRepository(ClassSubject)
      .createQueryBuilder('cs')
      .innerJoinAndSelect('cs.subject', 's', 's.deleted_at IS NULL AND s.tenant_id = :tenantId')
      .where('cs.tenant_id = :tenantId', { tenantId })
      .andWhere('cs.class_id = :classId', { classId: exam.class_id })
      .andWhere('cs.academic_year_id = :yearId', { yearId: exam.academic_year_id })
      .andWhere('cs.deleted_at IS NULL')
      .getMany();
    const subjectIdByCode = new Map(offered.map((cs) => [cs.subject.code, cs.subject_id]));

    const rows = await this.templatesService.componentsFor(
      manager,
      tenantId,
      templateId,
      numericGrade,
      [...subjectIdByCode.keys()],
    );
    if (!rows.length) return 0;

    // Imported/preset templates skip validateRows; two ATTENDANCE parts would double-count.
    const attendanceSeen = new Set<string>();
    for (const r of rows) {
      if (r.kind !== ExamComponentKind.ATTENDANCE) continue;
      if (attendanceSeen.has(r.subject_code)) {
        throw new BadRequestException(
          `Template has more than one ATTENDANCE component for subject ${r.subject_code}; fix the template first`,
        );
      }
      attendanceSeen.add(r.subject_code);
    }

    // numeric(6,2) values stay strings; ATTENDANCE rows must be DERIVED (exam-components rule).
    await manager.getRepository(ExamComponent).save(
      rows.map((r) =>
        manager.getRepository(ExamComponent).create({
          tenant_id: tenantId,
          exam_id: exam.id,
          subject_id: subjectIdByCode.get(r.subject_code)!,
          name: r.name,
          kind: r.kind,
          source:
            r.kind === ExamComponentKind.ATTENDANCE
              ? ExamComponentSource.DERIVED
              : ExamComponentSource.MANUAL,
          full_marks: r.full_marks,
          pass_marks: r.pass_marks,
          sequence: r.sequence,
        }),
      ),
    );
    return rows.length;
  }

  async findAll(
    query: QueryExamDto,
    tenantId: string,
  ): Promise<{ data: Exam[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { tenant_id: tenantId, deleted_at: IsNull() };
    if (query.academic_year_id) where.academic_year_id = query.academic_year_id;
    if (query.class_id) where.class_id = query.class_id;

    const [data, total] = await this.repo.findAndCount({
      where,
      // `Exam.class` is part of the response type; the analysis screen
      // labels its print header with it.
      relations: { class: true },
      order: { created_at: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, tenantId: string): Promise<Exam> {
    const entity = await this.repo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException('Exam not found');
    }
    return entity;
  }

  /** Whether any Mark row exists for this exam — once one does, class/year
   * can no longer change (issue's rule #1): moving an exam to a different
   * class/year after marks were entered would orphan those marks against
   * a class/year they were never entered for, rather than cascade them. */
  private async hasMarks(examId: string, tenantId: string): Promise<boolean> {
    const count = await this.markRepo.count({ where: { exam_id: examId, tenant_id: tenantId } });
    return count > 0;
  }

  async update(
    id: string,
    dto: UpdateExamDto,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<Exam> {
    const existing = await this.findOne(id, tenantId);

    const changesClass = dto.class_id !== undefined && dto.class_id !== existing.class_id;
    const changesYear =
      dto.academic_year_id !== undefined && dto.academic_year_id !== existing.academic_year_id;
    if (changesClass || changesYear) {
      if (await this.hasMarks(id, tenantId)) {
        throw new ConflictException(
          'Cannot change class or academic year on this exam: marks already exist for it.',
        );
      }
    }

    // [ACAD-05] Once published, only a rename is allowed; anything that
    // changes how the results read goes through "reopen" (approval-gated).
    const changesReadings = (e: Exam) =>
      (dto.class_id !== undefined && dto.class_id !== e.class_id) ||
      (dto.academic_year_id !== undefined && dto.academic_year_id !== e.academic_year_id) ||
      (dto.kind !== undefined && dto.kind !== e.kind) ||
      (dto.academic_term_id !== undefined && dto.academic_term_id !== e.academic_term_id);
    if (existing.status === ExamStatus.PUBLISHED && changesReadings(existing)) {
      throw examPublished();
    }

    // Same IDOR guard as create() — re-validated whenever any of these
    // three fields is present in the PATCH, even the ones that didn't
    // "change" from the exam's own recorded value, since a caller could
    // otherwise smuggle in a same-value-looking id from another tenant.
    if (
      dto.class_id !== undefined ||
      dto.academic_year_id !== undefined ||
      dto.academic_term_id !== undefined
    ) {
      await this.assertReferencesBelongToTenant(tenantId, {
        classId: dto.class_id ?? existing.class_id,
        academicYearId: dto.academic_year_id ?? existing.academic_year_id,
        academicTermId:
          dto.academic_term_id !== undefined ? dto.academic_term_id : existing.academic_term_id,
      });
    }

    const changedKeys = Object.keys(dto);
    if (changedKeys.length > 0) {
      try {
        await this.repo.manager.transaction(async (manager) => {
          const locked = await lockExam(manager, id, tenantId);
          if (locked.status === ExamStatus.PUBLISHED && changesReadings(locked)) {
            throw examPublished();
          }
          const repo = manager.getRepository(Exam);
          const oldValues = Object.fromEntries(
            changedKeys.map((key) => [key, (existing as any)[key]]),
          );

          await repo.update({ id, tenant_id: tenantId }, dto);

          await this.auditService.record(
            {
              action: AuditAction.UPDATE,
              entity_type: 'Exam',
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

          // The term feeds the DERIVED attendance component.
          if (
            locked.status === ExamStatus.PROCESSED &&
            dto.academic_term_id !== undefined &&
            dto.academic_term_id !== existing.academic_term_id
          ) {
            await this.resultsService.recomputeProcessedExam(
              manager,
              id,
              tenantId,
              userId,
              context,
            );
          }
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException({
            message: 'An exam with this name already exists for this class and academic year.',
            details: { code: 'EXAM_NAME_TAKEN' },
          });
        }
        throw err;
      }
    }

    return this.findOne(id, tenantId);
  }

  async remove(
    id: string,
    tenantId: string,
    userId: string | null = null,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<void> {
    const existing = await this.findOne(id, tenantId);

    await this.repo.manager.transaction(async (manager) => {
      await lockExam(manager, id, tenantId);
      const liveResults = await manager
        .getRepository(Result)
        .count({ where: { exam_id: id, tenant_id: tenantId, deleted_at: IsNull() } });
      if (liveResults > 0) {
        throw new ConflictException({
          message: 'This exam has results. Reopen and correct them instead of deleting the exam.',
          details: { code: 'EXAM_HAS_RESULTS' },
        });
      }
      // [70.2.1] A final result's share row pins this exam (also a NO ACTION FK). The exam's own
      // children (components, marks, grids, schedules) and results are counted above or have
      // always gone with it, so they are excluded; anything else that points here blocks.
      await assertNoLiveDependents(manager, Exam, id, {
        code: 'EXAM_IN_USE',
        message: 'This exam is still used by other records. Remove or reassign them first.',
        exclude: [
          'ExamComponent.exam',
          'Mark.exam',
          'MarkGrid.exam',
          'Result.exam',
          'ExamSchedule.exam',
          // Remarks on this exam's own report card never blocked its delete before Epic 70.
          'ReportCardNote.exam',
        ],
      });
      const repo = manager.getRepository(Exam);
      await repo.softDelete({ id, tenant_id: tenantId });

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'Exam',
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
    });
  }
}
