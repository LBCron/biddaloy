import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NoticeStatus } from '@biddaloy/shared';
import { NoticeAlertsService } from '../../attention/notice/notice-alerts.service';
import { normalizeSearchTerm } from '../../../common/utils/normalize-search-term.util';
import { SchoolsService } from '../../schools/schools.service';
import { NoticeAttachment } from '../entities/notice-attachment.entity';
import { toDto as toFileDto } from './notice-files.service';
import type {
  NoticeMineDetailDto,
  NoticeMineItemDto,
  NoticeMineListDto,
  NoticeMineQueryDto,
} from './dto/notice-reader.dto';

type Row = {
  id: string;
  title: string;
  body?: string;
  important: boolean;
  pinned: boolean;
  published_at: Date | null;
  expires_on: string | null;
  edited_at: Date | null;
  seen: boolean;
  acknowledged: boolean;
  for_students: string[] | null;
};

const toItem = (r: Row): NoticeMineItemDto => ({
  id: r.id,
  title: r.title,
  important: r.important,
  pinned: r.pinned,
  published_at: r.published_at ? new Date(r.published_at).toISOString() : null,
  expires_on: r.expires_on,
  edited: r.edited_at !== null,
  seen: r.seen,
  acknowledged: r.acknowledged,
  forStudents: r.for_students ?? [],
});

/** [53.2.02] Reader side of the notice board. Identity-scoped: only rows where recipient.user_id = me. */
@Injectable()
export class NoticeReaderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly alerts: NoticeAlertsService,
    private readonly schools: SchoolsService,
  ) {}

  async list(tenantId: string, userId: string, q: NoticeMineQueryDto): Promise<NoticeMineListDto> {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const term = normalizeSearchTerm(q.q);
    // "Today" is the school's calendar day, not the database's (expires_on is a school-local date).
    // ponytail: the year filter compares published_at in the DB session timezone (UTC); a notice
    // published in the last hours of 31 Dec local time may land in the next year. Fix if it matters.
    const base = [
      tenantId,
      userId,
      NoticeStatus.PUBLISHED,
      q.tab === 'archive',
      await this.schools.todayFor(tenantId),
      term ? `%${term}%` : null,
      q.year ?? null,
    ];
    const [{ total }] = await this.dataSource.query(
      `SELECT count(DISTINCT n.id)::int AS total FROM notices n
         JOIN notice_recipients r ON r.notice_id = n.id AND r.tenant_id = n.tenant_id
        WHERE r.tenant_id = $1 AND n.tenant_id = $1 AND r.user_id = $2 AND n.status = $3
          AND (($4::boolean AND n.expires_on < $5::date)
               OR (NOT $4::boolean AND (n.expires_on IS NULL OR n.expires_on >= $5::date)))
          AND ($6::text IS NULL OR n.title ILIKE $6::text)
          AND ($7::int IS NULL OR (n.published_at >= make_date($7::int, 1, 1)
                                   AND n.published_at < make_date($7::int + 1, 1, 1)))`,
      base,
    );
    const rows: Row[] = await this.dataSource.query(
      `SELECT n.id, n.title, n.important, n.pinned, n.published_at,
         to_char(n.expires_on, 'YYYY-MM-DD') AS expires_on, n.edited_at,
         bool_or(r.seen_at IS NOT NULL) AS seen,
         bool_or(r.acknowledged_at IS NOT NULL) AS acknowledged,
         array_agg(DISTINCT s.full_name) FILTER (WHERE r.kind = 'GUARDIAN' AND s.full_name IS NOT NULL) AS for_students
        FROM notices n
    JOIN notice_recipients r ON r.notice_id = n.id AND r.tenant_id = n.tenant_id
    LEFT JOIN students s ON s.id = r.student_id AND s.tenant_id = n.tenant_id
        WHERE r.tenant_id = $1 AND n.tenant_id = $1 AND r.user_id = $2 AND n.status = $3
          AND (($4::boolean AND n.expires_on < $5::date)
               OR (NOT $4::boolean AND (n.expires_on IS NULL OR n.expires_on >= $5::date)))
          AND ($6::text IS NULL OR n.title ILIKE $6::text)
          AND ($7::int IS NULL OR (n.published_at >= make_date($7::int, 1, 1)
                                   AND n.published_at < make_date($7::int + 1, 1, 1)))
        GROUP BY n.id
        ORDER BY n.pinned DESC, n.published_at DESC, n.id
        LIMIT $8 OFFSET $9`,
      [...base, limit, (page - 1) * limit],
    );
    return { data: rows.map(toItem), total, page, limit };
  }

  /** Not mine, withdrawn or draft: 404. Sets seen_at once (D22). */
  async open(tenantId: string, userId: string, noticeId: string): Promise<NoticeMineDetailDto> {
    const row = await this.mine(tenantId, userId, noticeId);
    await this.dataSource.query(
      `UPDATE notice_recipients SET seen_at = now()
        WHERE tenant_id = $1 AND notice_id = $2 AND user_id = $3 AND seen_at IS NULL`,
      [tenantId, noticeId, userId],
    );
    const files = await this.dataSource.manager.find(NoticeAttachment, {
      where: { tenant_id: tenantId, notice_id: noticeId },
      order: { sort: 'ASC', created_at: 'ASC' },
    });
    return {
      ...toItem({ ...row, seen: true }),
      body: row.body ?? '',
      files: files.map(toFileDto),
    };
  }

  async acknowledge(tenantId: string, userId: string, noticeId: string): Promise<void> {
    const row = await this.mine(tenantId, userId, noticeId);
    if (!row.important) throw new NotFoundException('Notice not found');
    await this.dataSource.transaction((tx) =>
      this.alerts.acknowledge(tx, tenantId, noticeId, userId),
    );
  }

  private async mine(tenantId: string, userId: string, noticeId: string): Promise<Row> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT n.id, n.title, n.body, n.important, n.pinned, n.published_at,
         to_char(n.expires_on, 'YYYY-MM-DD') AS expires_on, n.edited_at,
         bool_or(r.seen_at IS NOT NULL) AS seen,
         bool_or(r.acknowledged_at IS NOT NULL) AS acknowledged,
         array_agg(DISTINCT s.full_name) FILTER (WHERE r.kind = 'GUARDIAN' AND s.full_name IS NOT NULL) AS for_students
        FROM notices n
    JOIN notice_recipients r ON r.notice_id = n.id AND r.tenant_id = n.tenant_id
    LEFT JOIN students s ON s.id = r.student_id AND s.tenant_id = n.tenant_id
        WHERE n.tenant_id = $1 AND r.tenant_id = $1 AND r.user_id = $2 AND n.id = $3 AND n.status = $4
        GROUP BY n.id`,
      [tenantId, userId, noticeId, NoticeStatus.PUBLISHED],
    );
    if (!rows[0]) throw new NotFoundException('Notice not found');
    return rows[0];
  }
}
