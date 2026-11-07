import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SchoolsService } from '../../../schools/schools.service';
import type { Feed, FeedRow } from './feed-registry';

/** Admission intakes open today (the school's date): title, deadline and the apply link. */
@Injectable()
export class AdmissionsFeed implements Feed {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly schools: SchoolsService,
  ) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    const today = await this.schools.todayFor(tenantId);
    const rows: {
      id: string;
      title: string;
      close_date: string;
      slug: string;
    }[] = await this.ds.query(
      `SELECT i.id, i.title, to_char(i.close_date, 'YYYY-MM-DD') AS close_date, s.slug
         FROM admission_intakes i
         JOIN schools s ON s.id = i.tenant_id
        WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
          AND i.open_date <= $2::date AND i.close_date >= $2::date
        ORDER BY i.close_date, i.id
        LIMIT 20`,
      [tenantId, today],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      deadline: r.close_date,
      link: `/admission/${r.slug}`,
    }));
  }
}
