import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Feed, FeedRow } from './feed-registry';

/** The routine picker shows at most this many sections. */
export const CLASS_SECTIONS_MAX = 60;

/**
 * The picker list of the site's routine section: `[{ id, label }]` for the live class sections of
 * the current academic year. `label` is "<class> <section>" as the school typed them (the school
 * stores one name, so both languages carry it). Only the page's `routine` section receives it.
 */
@Injectable()
export class ClassSectionsFeed implements Feed {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    const rows: { id: string; class_name: string; section_name: string }[] = await this.ds.query(
      `SELECT cs.id, c.name AS class_name, cs.section_name
         FROM class_sections cs
         JOIN classes c ON c.id = cs.class_id AND c.tenant_id = cs.tenant_id
         JOIN academic_years y ON y.id = c.academic_year_id AND y.tenant_id = c.tenant_id
        WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL AND c.deleted_at IS NULL
          AND y.is_current = true AND y.deleted_at IS NULL
        ORDER BY c.name, cs.section_name, cs.id
        LIMIT ${CLASS_SECTIONS_MAX}`,
      [tenantId],
    );
    return rows.map((r) => {
      const label = `${r.class_name} ${r.section_name}`;
      return { id: r.id, label: { bn: label, en: label } };
    });
  }
}
