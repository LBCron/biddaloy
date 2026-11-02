import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  AuditAction,
  ConductGrade,
  ConductItem,
  DEFAULT_CONDUCT_ITEMS,
  ExamStatus,
  FinalResultStatus,
} from '@biddaloy/shared';
import { reportCardNotesLocked } from '../../common/filters/known-errors';
import { RequestContext } from '../../common/request-context.util';
import { AuditService } from '../audit/audit.service';
import { ClassSection } from '../academics/entities/class-section.entity';
import { TeacherScopeService } from '../classes/teacher-scope.service';
import { Exam } from '../exams/entities/exam.entity';
import { lockExam } from '../exams/exam-lock';
import { FinalResult } from '../final-results/entities/final-result.entity';
import { SchoolsService } from '../schools/schools.service';
import { ReportCardNoteBodyDto } from './dto/report-card-notes.dto';
import { ReportCardNote } from './entities/report-card-note.entity';

export interface NotesTargetInput {
  exam_id?: string;
  final_result_id?: string;
}

/** What a note hangs on, resolved: the cohort is this class-year's enrollments (D25). */
interface ResolvedTarget {
  exam_id: string | null;
  final_result_id: string | null;
  class_id: string;
  academic_year_id: string;
  published: boolean;
}

export interface NotesRow {
  student_id: string;
  full_name: string;
  full_name_bn: string | null;
  roll_number: number;
  remark: string | null;
  conduct: Record<string, ConductGrade>;
}

export interface NotesView {
  target: { exam_id: string | null; final_result_id: string | null };
  section_id: string;
  locked: boolean;
  conduct_items: ConductItem[];
  rows: NotesRow[];
}

export interface NotesMissing {
  total: number;
  missing_remark: number;
  missing_conduct: number;
}

const GRADES = new Set<string>(Object.values(ConductGrade));

// Fixed sentences: no message echoes what was sent (Rule 23).
const notFound = () => new NotFoundException('Report card notes not found');
const badTarget = () => new BadRequestException('Give exactly one of exam_id or final_result_id.');

/**
 * [70.3.1] Remark + conduct grid per student, one section, one exam or final result (D7, D13).
 * One service behind the `my-class` (class teacher / assistant) and office (RESULT_PROCESS)
 * routes. Saves are idempotent upserts by `(student, target)`, so no Idempotency-Key (Rule 25).
 */
@Injectable()
export class ReportCardNotesService {
  constructor(
    @InjectRepository(ReportCardNote) private readonly repo: Repository<ReportCardNote>,
    private readonly auditService: AuditService,
    private readonly teacherScope: TeacherScopeService,
    private readonly schools: SchoolsService,
  ) {}

  // ---- teacher scope ---------------------------------------------------------------------

  /** Rule 2: only the section's class teacher / assistant; anyone else gets 404, never 403. */
  async assertHomeroom(tenantId: string, userId: string, sectionId: string): Promise<void> {
    const { homeroom } = await this.teacherScope.rolesInSection({ userId, tenantId, sectionId });
    if (!homeroom) throw notFound();
  }

  // ---- reads -----------------------------------------------------------------------------

  async get(tenantId: string, input: NotesTargetInput, sectionId: string): Promise<NotesView> {
    const manager = this.repo.manager;
    const target = await this.resolveTarget(manager, tenantId, input);
    await this.assertSection(manager, tenantId, sectionId, target.class_id);
    const items = await this.conductItems(tenantId);
    const rows = await this.rows(manager, tenantId, target, sectionId);
    return {
      target: { exam_id: target.exam_id, final_result_id: target.final_result_id },
      section_id: sectionId,
      locked: target.published,
      conduct_items: items,
      rows,
    };
  }

  /** D18: how many students still lack a remark / a full conduct grid. No section = whole class. */
  async missingCounts(
    tenantId: string,
    input: NotesTargetInput,
    sectionId?: string,
  ): Promise<NotesMissing> {
    const manager = this.repo.manager;
    const target = await this.resolveTarget(manager, tenantId, input);
    if (sectionId) await this.assertSection(manager, tenantId, sectionId, target.class_id);
    const keys = (await this.conductItems(tenantId)).map((i) => i.key);
    const rows = await this.rows(manager, tenantId, target, sectionId ?? null);
    return {
      total: rows.length,
      missing_remark: rows.filter((r) => !r.remark).length,
      missing_conduct: rows.filter((r) => keys.some((k) => !r.conduct[k])).length,
    };
  }

  // ---- write -----------------------------------------------------------------------------

  /** Upserts the given students' notes. Returns how many actually changed. */
  async save(
    tenantId: string,
    userId: string,
    input: NotesTargetInput,
    sectionId: string,
    notes: ReportCardNoteBodyDto[],
    context: RequestContext,
  ): Promise<{ changed: number }> {
    const items = await this.conductItems(tenantId);
    const allowedKeys = new Set(items.map((i) => i.key));
    const seen = new Set<string>();
    for (const n of notes) {
      if (seen.has(n.student_id)) throw new BadRequestException('A student appears twice.');
      seen.add(n.student_id);
      for (const [key, grade] of Object.entries(n.conduct)) {
        if (!allowedKeys.has(key)) throw new BadRequestException('Unknown conduct item.');
        if (!GRADES.has(grade))
          throw new BadRequestException('Conduct grade must be A, B, C or D.');
      }
    }

    return this.repo.manager.transaction(async (manager) => {
      const target = await this.resolveTarget(manager, tenantId, input, true);
      await this.assertSection(manager, tenantId, sectionId, target.class_id);
      // D28: checked under the row lock, so a publish racing this save cannot slip a write in.
      if (target.published) throw reportCardNotesLocked();

      const cohort = new Set(
        (await this.rows(manager, tenantId, target, sectionId)).map((r) => r.student_id),
      );
      if (notes.some((n) => !cohort.has(n.student_id))) {
        throw new BadRequestException('A student is not in this section.');
      }

      const existing = new Map(
        (await this.targetNotes(manager, tenantId, target, [...seen])).map((e) => [
          e.student_id,
          e,
        ]),
      );
      const changedIds: string[] = [];
      // Fixed student order, so two saves running together lock rows the same way (no deadlock).
      const ordered = [...notes].sort((a, b) => a.student_id.localeCompare(b.student_id));
      for (const n of ordered) {
        const before = existing.get(n.student_id);
        // Omitted remark keeps the stored one; null or blank clears it.
        const remark = n.remark === undefined ? (before?.remark ?? null) : n.remark?.trim() || null;
        // Grades under an item the school has since removed stay untouched (settings DTO doc).
        const stale = Object.fromEntries(
          Object.entries(before?.conduct ?? {}).filter(([k]) => !allowedKeys.has(k)),
        );
        const conduct = { ...stale, ...n.conduct } as Record<string, ConductGrade>;
        const same = before
          ? before.remark === remark && sameConduct(before.conduct, conduct)
          : remark === null && Object.keys(conduct).length === 0;
        if (same) continue;
        changedIds.push(n.student_id);
        await manager.query(
          `INSERT INTO report_card_notes
             (tenant_id, student_id, exam_id, final_result_id, remark, conduct, updated_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
           ON CONFLICT (student_id, exam_id, final_result_id)
           DO UPDATE SET
             -- Decided here, on the locked row, so a save racing this one cannot be undone by a
             -- stale read: an omitted remark keeps the stored one, and grades under items the
             -- school has since removed stay.
             remark = CASE WHEN $8::boolean THEN report_card_notes.remark ELSE EXCLUDED.remark END,
             conduct = (report_card_notes.conduct - $9::text[]) || EXCLUDED.conduct,
             updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`,
          [
            tenantId,
            n.student_id,
            target.exam_id,
            target.final_result_id,
            remark,
            JSON.stringify(n.conduct),
            userId,
            n.remark === undefined,
            [...allowedKeys],
          ],
        );
      }
      const changed = changedIds.length;
      if (changed > 0) {
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: target.final_result_id ? ('FinalResult' as const) : ('Exam' as const),
            entity_id: (target.final_result_id ?? target.exam_id)!,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: null,
            new_values: {
              report_card_notes: { section_id: sectionId, changed, student_ids: changedIds },
            },
          },
          manager,
        );
      }
      return { changed };
    });
  }

  // ---- helpers ---------------------------------------------------------------------------

  private async conductItems(tenantId: string): Promise<ConductItem[]> {
    const settings = await this.schools.getResolvedSettings(tenantId);
    return settings.exams?.conductItems ?? DEFAULT_CONDUCT_ITEMS;
  }

  /** Exactly one target, live and in this tenant, else 400 / 404. `lock` = read lock for save. */
  private async resolveTarget(
    manager: EntityManager,
    tenantId: string,
    input: NotesTargetInput,
    lock = false,
  ): Promise<ResolvedTarget> {
    if (!!input.exam_id === !!input.final_result_id) throw badTarget();
    if (input.exam_id) {
      // Saves reuse the shared exam lock helper (one lock-order contract with marks / publish).
      const exam = lock
        ? await lockExam(manager, input.exam_id, tenantId, 'pessimistic_read')
        : await manager.findOne(Exam, { where: { id: input.exam_id, tenant_id: tenantId } });
      if (!exam) throw notFound();
      return {
        exam_id: exam.id,
        final_result_id: null,
        class_id: exam.class_id,
        academic_year_id: exam.academic_year_id,
        published: exam.status === ExamStatus.PUBLISHED,
      };
    }
    const final = await manager.findOne(FinalResult, {
      where: { id: input.final_result_id!, tenant_id: tenantId },
      lock: lock ? ({ mode: 'pessimistic_read' } as const) : undefined,
    });
    if (!final) throw notFound();
    return {
      exam_id: null,
      final_result_id: final.id,
      class_id: final.class_id,
      academic_year_id: final.academic_year_id,
      published: final.status === FinalResultStatus.PUBLISHED,
    };
  }

  /** The section must be a live section of the target's class. */
  private async assertSection(
    manager: EntityManager,
    tenantId: string,
    sectionId: string,
    classId: string,
  ): Promise<void> {
    const section = await manager.findOne(ClassSection, {
      where: { id: sectionId, tenant_id: tenantId, class_id: classId },
      select: { id: true },
    });
    if (!section) throw notFound();
  }

  /** Cohort rows (ACTIVE or GRADUATED enrollment: the same cohort final results build, D25) of the section (or whole class) with their notes. */
  private async rows(
    manager: EntityManager,
    tenantId: string,
    target: ResolvedTarget,
    sectionId: string | null,
  ): Promise<NotesRow[]> {
    const cohort: {
      id: string;
      full_name: string;
      full_name_bn: string | null;
      roll_number: number;
    }[] = await manager.query(
      // One row per student (the ACTIVE enrollment wins over GRADUATED), then the section filter.
      `SELECT id, full_name, full_name_bn, roll_number FROM (
         SELECT DISTINCT ON (st.id) st.id, st.full_name, st.full_name_bn, st.roll_number, e.section_id
           FROM enrollments e
           JOIN students st ON st.id = e.student_id AND st.tenant_id = $1 AND st.deleted_at IS NULL
          WHERE e.tenant_id = $1 AND e.academic_year_id = $2 AND e.class_id = $3
            AND e.enrollment_status IN ('ACTIVE', 'GRADUATED')
          ORDER BY st.id, (e.enrollment_status = 'ACTIVE') DESC
       ) cohort
        WHERE ($4::uuid IS NULL OR section_id = $4::uuid)
        ORDER BY roll_number, full_name, id`,
      [tenantId, target.academic_year_id, target.class_id, sectionId],
    );
    const notes = new Map(
      (
        await this.targetNotes(
          manager,
          tenantId,
          target,
          cohort.map((c) => c.id),
        )
      ).map((n) => [n.student_id, n]),
    );
    return cohort.map((c) => ({
      student_id: c.id,
      full_name: c.full_name,
      full_name_bn: c.full_name_bn,
      roll_number: c.roll_number,
      remark: notes.get(c.id)?.remark ?? null,
      conduct: notes.get(c.id)?.conduct ?? {},
    }));
  }

  private targetNotes(
    manager: EntityManager,
    tenantId: string,
    target: ResolvedTarget,
    studentIds: string[],
  ): Promise<ReportCardNote[]> {
    if (studentIds.length === 0) return Promise.resolve([]);
    return manager
      .getRepository(ReportCardNote)
      .createQueryBuilder('n')
      .where('n.tenant_id = :tenantId', { tenantId })
      .andWhere(target.exam_id ? 'n.exam_id = :tid' : 'n.final_result_id = :tid', {
        tid: target.exam_id ?? target.final_result_id,
      })
      .andWhere('n.student_id IN (:...studentIds)', { studentIds })
      .getMany();
  }
}

function sameConduct(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
