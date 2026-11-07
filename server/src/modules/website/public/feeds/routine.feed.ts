import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolsService } from '../../../schools/schools.service';
import type { Feed, FeedOpts, FeedRow } from './feed-registry';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The published class routine of one section: the weekly slots in force today. No section, a bad
 * id, or a routine that is not PUBLISHED answers `[]` (a DRAFT or REVIEW routine never leaves the
 * school). Substitutions and recurrence are not applied: this is the standing weekly grid.
 */
@Injectable()
export class RoutineFeed implements Feed {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly schools: SchoolsService,
  ) {}

  async load(tenantId: string, opts: FeedOpts = {}): Promise<FeedRow[]> {
    const section = opts.classSectionId;
    if (!section || !UUID_RE.test(section)) return [];
    const today = await this.schools.todayFor(tenantId);
    const rows: {
      weekday: number;
      starts_at: string;
      ends_at: string;
      period: string | null;
      subject_en: string;
      subject_bn: string | null;
    }[] = await this.ds.query(
      `SELECT s.weekday, to_char(p.starts_at, 'HH24:MI') AS starts_at,
              to_char(p.ends_at, 'HH24:MI') AS ends_at, p.name AS period,
              sub.name_en AS subject_en, sub.name_bn AS subject_bn
         FROM routine_slots s
         JOIN routines r ON r.id = s.routine_id AND r.tenant_id = s.tenant_id
         JOIN period_slots p ON p.id = s.period_slot_id AND p.tenant_id = s.tenant_id
         JOIN subjects sub ON sub.id = s.subject_id AND sub.tenant_id = s.tenant_id
         JOIN class_sections cs ON cs.id = s.section_id AND cs.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.section_id = $2::uuid
          AND r.state = 'PUBLISHED' AND r.deleted_at IS NULL AND cs.deleted_at IS NULL
          AND s.valid_from <= $3::date AND (s.valid_to IS NULL OR s.valid_to > $3::date)
        ORDER BY s.weekday, p.starts_at, s.id
        LIMIT 200`,
      [tenantId, section, today],
    );
    return rows.map((r) => ({
      weekday: r.weekday,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      period: r.period,
      subject: { bn: r.subject_bn ?? r.subject_en, en: r.subject_en },
    }));
  }
}
