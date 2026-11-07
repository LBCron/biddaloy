import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { Exam } from './entities/exam.entity';
import { signResultHandle, verifyResultHandle } from './website-results.handle';

export const WEBSITE_RESULTS_PAGE_SIZE = 100;
/** Newest exams the island lists; a school publishes a handful a year. */
const LISTED_EXAMS_MAX = 50;

/** One fixed 404 for an unknown, unpublished, withdrawn or other-school exam (Rule 23). */
export const resultsNotFound = () => new NotFoundException('results.not_found');

export interface WebsiteResultRow {
  /** Signed, 30-minute pointer for the lazy per-subject `detail`; never a student or result id. */
  handle: string;
  roll: number;
  /** null when the school switched names off (D36). */
  name: string | null;
  gpa: number;
  grade: string;
  passed: boolean;
}

/**
 * [40.5.01] Results on the public school site. Admin side: publish, withdraw, names switch (all
 * bump `school_sites.version`, D32). Public side: `listPublished`, `query`, `detail`; every read
 * is scoped by tenant AND requires status PUBLISHED AND `website_published_at`, so withdrawing
 * (or reopening the exam) hides it on the next request. No student id, contact or section
 * roster leaves this class (D36).
 */
@Injectable()
export class WebsiteResultsService {
  constructor(
    @InjectRepository(Exam) private readonly exams: Repository<Exam>,
    private readonly audit: AuditService,
  ) {}

  /** Runs one guarded UPDATE; when it touched the exam, bumps the site version and audits. */
  private async change(
    examId: string,
    tenantId: string,
    userId: string,
    ctx: RequestContext,
    updateSql: string,
    oldValues: Record<string, unknown>,
    newValues: Record<string, unknown>,
  ): Promise<boolean> {
    return this.exams.manager.transaction(async (m) => {
      // TypeORM's postgres driver answers an UPDATE ... RETURNING as `[rows, affectedCount]`.
      const [rows]: [unknown[], number] = await m.query(updateSql, [examId, tenantId]);
      if (rows.length === 0) return false;
      await this.bumpAndAudit(m, examId, tenantId, userId, ctx, oldValues, newValues);
      return true;
    });
  }

  private async bumpAndAudit(
    m: Repository<Exam>['manager'],
    examId: string,
    tenantId: string,
    userId: string,
    ctx: RequestContext,
    oldValues: Record<string, unknown>,
    newValues: Record<string, unknown>,
  ) {
    await m.query(`UPDATE school_sites SET version = version + 1 WHERE tenant_id = $1`, [tenantId]);
    await this.audit.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'Exam',
        entity_id: examId,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        ip_address: ctx.ip,
        user_agent: ctx.userAgent,
        old_values: oldValues,
        new_values: newValues,
      },
      m,
    );
  }

  private async findExam(examId: string, tenantId: string): Promise<Exam> {
    const exam = await this.exams.findOne({
      where: { id: examId, tenant_id: tenantId },
      select: { id: true, status: true, website_show_names: true },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  /** Only a PUBLISHED exam (D2). Already on the website: nothing to do. */
  async publish(examId: string, tenantId: string, userId: string, ctx: RequestContext) {
    const done = await this.change(
      examId,
      tenantId,
      userId,
      ctx,
      `UPDATE exams SET website_published_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          AND status = 'PUBLISHED' AND website_published_at IS NULL RETURNING id`,
      { website_published: false },
      { website_published: true },
    );
    if (done) return;
    const exam = await this.findExam(examId, tenantId);
    if (exam.status !== 'PUBLISHED') {
      throw new ConflictException('Only an exam with published results can go on the website.');
    }
  }

  async unpublish(examId: string, tenantId: string, userId: string, ctx: RequestContext) {
    const done = await this.change(
      examId,
      tenantId,
      userId,
      ctx,
      `UPDATE exams SET website_published_at = NULL
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          AND website_published_at IS NOT NULL RETURNING id`,
      { website_published: true },
      { website_published: false },
    );
    if (!done) await this.findExam(examId, tenantId); // 404 for a missing exam, else no-op
  }

  async setShowNames(
    examId: string,
    tenantId: string,
    userId: string,
    ctx: RequestContext,
    showNames: boolean,
  ) {
    const exam = await this.findExam(examId, tenantId);
    if (exam.website_show_names === showNames) return; // nothing changed: no bump, no audit row
    await this.exams.manager.transaction(async (m) => {
      await m.query(`UPDATE exams SET website_show_names = $3 WHERE id = $1 AND tenant_id = $2`, [
        examId,
        tenantId,
        showNames,
      ]);
      await this.bumpAndAudit(
        m,
        examId,
        tenantId,
        userId,
        ctx,
        { website_show_names: exam.website_show_names },
        { website_show_names: showNames },
      );
    });
  }

  /** Exams on the website with the sections that have results: the island's three selects. */
  async listPublished(tenantId: string) {
    const exams: { id: string; name: string; show_names: boolean }[] =
      await this.exams.manager.query(
        `SELECT id, name, website_show_names AS show_names FROM exams
          WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'PUBLISHED'
            AND website_published_at IS NOT NULL
          ORDER BY website_published_at DESC, id LIMIT $2`,
        [tenantId, LISTED_EXAMS_MAX],
      );
    if (exams.length === 0) return [];
    const rows: {
      exam_id: string;
      class_name: string;
      section_id: string;
      section_name: string;
    }[] = await this.exams.manager.query(
      `SELECT r.exam_id, c.name AS class_name, cs.id AS section_id, cs.section_name
         FROM (SELECT DISTINCT exam_id, section_id FROM results
                WHERE tenant_id = $1 AND deleted_at IS NULL AND exam_id = ANY($2::uuid[])
                  AND section_id IS NOT NULL) r
         JOIN class_sections cs
           ON cs.id = r.section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.numeric_grade NULLS LAST, c.name, cs.section_name`,
      [tenantId, exams.map((e) => e.id)],
    );
    const byExam = new Map(
      exams.map((e) => [
        e.id,
        { id: e.id, name: e.name, showNames: e.show_names, sections: [] as unknown[] },
      ]),
    );
    for (const r of rows) {
      byExam
        .get(r.exam_id)
        ?.sections.push({ id: r.section_id, className: r.class_name, sectionName: r.section_name });
    }
    // An exam none of whose sections is left (deleted) has nothing to pick.
    return [...byExam.values()].filter((e) => e.sections.length > 0);
  }

  /** The exam's `show_names` when it is on the website for this school, else the one 404. */
  private async visible(tenantId: string, examId: string): Promise<boolean> {
    const rows: { show: boolean }[] = await this.exams.manager.query(
      `SELECT website_show_names AS show FROM exams
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          AND status = 'PUBLISHED' AND website_published_at IS NOT NULL`,
      [examId, tenantId],
    );
    if (rows.length === 0) throw resultsNotFound();
    return rows[0].show;
  }

  async query(
    tenantId: string,
    q: { examId: string; classSectionId: string; roll?: number; page: number },
  ) {
    const showNames = await this.visible(tenantId, q.examId);
    const rows: {
      id: string;
      roll: number;
      name: string;
      gpa: string;
      grade: string;
      is_fail: boolean;
    }[] = await this.exams.manager.query(
      `SELECT r.id, s.roll_number AS roll, s.full_name AS name, r.gpa, r.grade, r.is_fail
         FROM results r
         JOIN students s
           ON s.id = r.student_id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
        WHERE r.exam_id = $1 AND r.tenant_id = $2 AND r.deleted_at IS NULL
          AND r.section_id = $3 AND ($4::int IS NULL OR s.roll_number = $4::int)
        ORDER BY s.roll_number, r.id
        LIMIT $5 OFFSET $6`,
      [
        q.examId,
        tenantId,
        q.classSectionId,
        q.roll ?? null,
        WEBSITE_RESULTS_PAGE_SIZE,
        (q.page - 1) * WEBSITE_RESULTS_PAGE_SIZE,
      ],
    );
    // Counted on its own: a page past the end has no rows to carry the total, and the pager must
    // still be right.
    const [{ n }]: { n: string }[] = await this.exams.manager.query(
      `SELECT COUNT(*) AS n FROM results r
         JOIN students s
           ON s.id = r.student_id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
        WHERE r.exam_id = $1 AND r.tenant_id = $2 AND r.deleted_at IS NULL
          AND r.section_id = $3 AND ($4::int IS NULL OR s.roll_number = $4::int)`,
      [q.examId, tenantId, q.classSectionId, q.roll ?? null],
    );
    return {
      page: q.page,
      pageSize: WEBSITE_RESULTS_PAGE_SIZE,
      total: Number(n),
      showNames,
      rows: rows.map((r): WebsiteResultRow => ({
        handle: signResultHandle(tenantId, q.examId, r.id),
        roll: r.roll,
        name: showNames ? r.name : null,
        gpa: Number(r.gpa),
        grade: r.grade,
        passed: !r.is_fail,
      })),
    };
  }

  /** Per-subject marks of one result row (D9). Only a handle a `query` answer carried opens it. */
  async detail(tenantId: string, handle: unknown) {
    const h = verifyResultHandle(handle, tenantId);
    if (!h) throw resultsNotFound();
    const { examId, resultId } = h;
    await this.visible(tenantId, examId);
    const rows: {
      name_en: string;
      name_bn: string | null;
      obtained: string;
      grade: string;
      gpa: string;
      is_fail: boolean;
    }[] = await this.exams.manager.query(
      `SELECT sub.name_en, sub.name_bn, rs.obtained, rs.grade, rs.gpa, rs.is_fail
         FROM results r
         JOIN students s
           ON s.id = r.student_id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
         JOIN result_subjects rs
           ON rs.result_id = r.id AND rs.tenant_id = r.tenant_id AND rs.deleted_at IS NULL
         JOIN subjects sub ON sub.id = rs.subject_id AND sub.tenant_id = r.tenant_id
        WHERE r.id = $1 AND r.exam_id = $2 AND r.tenant_id = $3 AND r.deleted_at IS NULL
        ORDER BY sub.name_en`,
      [resultId, examId, tenantId],
    );
    if (rows.length === 0) throw resultsNotFound();
    return {
      subjects: rows.map((r) => ({
        name: { en: r.name_en, bn: r.name_bn },
        obtained: Number(r.obtained),
        grade: r.grade,
        gpa: Number(r.gpa),
        passed: !r.is_fail,
      })),
    };
  }
}
