import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolsService } from '../../../schools/schools.service';
import type { Feed, FeedRow } from './feed-registry';

/**
 * The next 10 published calendar events and holidays of the current academic year that every
 * visitor may see: audience ALL and not scoped to a class (a class-scoped or staff-only event
 * never leaves the school). Today is the school's own date, not the database's UTC day.
 */
@Injectable()
export class EventsFeed implements Feed {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly schools: SchoolsService,
  ) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    const today = await this.schools.todayFor(tenantId);
    const rows: {
      id: string;
      name: string;
      type: string;
      date: string;
      end_date: string;
    }[] = await this.ds.query(
      `SELECT e.id, e.name, e.type,
              to_char(e.start_date, 'YYYY-MM-DD') AS date,
              to_char(e.end_date, 'YYYY-MM-DD') AS end_date
         FROM calendar_events e
         JOIN academic_years y ON y.id = e.academic_year_id AND y.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1
          AND e.deleted_at IS NULL AND y.deleted_at IS NULL AND y.is_current = true
          AND e.published_at IS NOT NULL
          AND e.audience = 'ALL'
          AND NOT EXISTS (SELECT 1 FROM calendar_event_classes c WHERE c.event_id = e.id)
          AND e.end_date >= $2::date
        ORDER BY e.start_date, e.start_time NULLS FIRST, e.id
        LIMIT 10`,
      [tenantId, today],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.name,
      type: r.type,
      date: r.date,
      endDate: r.end_date,
    }));
  }
}
