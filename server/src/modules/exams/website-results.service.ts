import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { Exam } from './entities/exam.entity';

export const WEBSITE_RESULTS_PAGE_SIZE = 100;
/** Newest exams the island lists; a school publishes a handful a year. */
const LISTED_EXAMS_MAX = 50;

/** One fixed 404 for an unknown, unpublished, withdrawn or other-school exam (Rule 23). */
export const resultsNotFound = () => new NotFoundException('results.not_found');

export interface WebsiteResultRow {
  /** Handle for the lazy per-subject `detail`; never a student id. */
  id: string;
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
    newValues: Record<string, unknown>,
  ): Promise<boolean> {
    return this.exams.manager.transaction(async (m) => {
      // TypeORM's postgres driver answers an UPDATE ... RETURNING as `[rows, affectedCount]`.
      const [rows]: [unknown[], number] = await m.query(updateSql, [examId, tenantId]);
      if (rows.length === 0) return false;
      await this.bumpAndAudit(m, examId, tenantId, userId, ctx, newValues);
      return true;
    });
  }

  private async bumpAndAudit(
    m: Repository<Exam>['manager'],
    examId: string,
    tenantId: string,
    userId: string,
    ctx: RequestContext,
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
        old_values: null,
        new_values: newValues,
      },
      m,
    );
  }

  private async findExam(examId: string, tenantId: string): Promise<Exam> {
    const exam = await this.exams.findOne({
      where: { id: examId, tenant_id: tenantId },
      select: { id: true, status: true },
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
    await this.findExam(examId, tenantId);
    await this.exams.manager.transaction(async (m) => {
      await m.query(`UPDATE exams SET website_show_names = $3 WHERE id = $1 AND tenant_id = $2`, [
        examId,
        tenantId,
        showNames,
      ]);
      await this.bumpAndAudit(m, examId, tenantId, userId, ctx, {
        website_show_names: showNames,
      });
    });
  }

  /** Exams on the website with the sections that have results: the island's three selects. */
  async listPublished(tenantId: string) {
    const rows: {
      exam_id: string;
      exam_name: string;
      show_names: boolean;
      class_name: string;
      section_id: string;
      section_name: string;
    }[] = await this.exams.manager.query(
      `SELECT e.id AS exam_id, e.name AS exam_name, e.website_show_names AS show_names,
              c.name AS class_name, cs.id AS section_id, cs.section_name
         FROM (SELECT * FROM exams
                WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'PUBLISHED'
                  AND website_published_at IS NOT NULL
                ORDER BY website_published_at DESC, id LIMIT ${LISTED_EXAMS_MAX}) e
         JOIN (SELECT DISTINCT exam_id, section_id FROM results
                WHERE tenant_id = $1 AND deleted_at IS NULL AND section_id IS NOT NULL) r
           ON r.exam_id = e.id
         JOIN class_sections cs
           ON cs.id = r.section_id AND cs.tenant_id = $1 AND cs.deleted_at IS NULL
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = $1
        ORDER BY e.website_published_at DESC, e.id, c.numeric_grade NULLS LAST, c.name,
                 cs.section_name`,
      [tenantId],
    );
    const byExam = new Map<
      string,
      { id: string; name: string; showNames: boolean; sections: unknown[] }
    >();
    for (const r of rows) {
      const e = byExam.get(r.exam_id) ?? {
        id: r.exam_id,
        name: r.exam_name,
        showNames: r.show_names,
        sections: [],
      };
      e.sections.push({ id: r.section_id, className: r.class_name, sectionName: r.section_name });
      byExam.set(r.exam_id, e);
    }
    return [...byExam.values()];
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
      total: string;
    }[] = await this.exams.manager.query(
      `SELECT r.id, s.roll_number AS roll, s.full_name AS name, r.gpa, r.grade, r.is_fail,
              COUNT(*) OVER() AS total
         FROM results r
         JOIN students s
           ON s.id = r.student_id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
        WHERE r.exam_id = $1 AND r.tenant_id = $2 AND r.deleted_at IS NULL
          AND r.section_id = $3 AND ($4::int IS NULL OR s.roll_number = $4::int)
        ORDER BY s.roll_number, r.id
        LIMIT ${WEBSITE_RESULTS_PAGE_SIZE} OFFSET $5`,
      [
        q.examId,
        tenantId,
        q.classSectionId,
        q.roll ?? null,
        (q.page - 1) * WEBSITE_RESULTS_PAGE_SIZE,
      ],
    );
    return {
      page: q.page,
      pageSize: WEBSITE_RESULTS_PAGE_SIZE,
      total: rows.length ? Number(rows[0].total) : 0,
      showNames,
      rows: rows.map((r): WebsiteResultRow => ({
        id: r.id,
        roll: r.roll,
        name: showNames ? r.name : null,
        gpa: Number(r.gpa),
        grade: r.grade,
        passed: !r.is_fail,
      })),
    };
  }

  /** Per-subject marks of one result row (D9). The row id came from a `query` answer. */
  async detail(tenantId: string, examId: string, resultId: string) {
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
