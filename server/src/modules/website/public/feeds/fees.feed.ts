import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Feed, FeedRow } from './feed-registry';

/**
 * The current academic year's fee structure: name, type, amount and the class it is labelled
 * with. Amounts only; no student, no due or payment data.
 */
@Injectable()
export class FeesFeed implements Feed {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async load(tenantId: string): Promise<FeedRow[]> {
    const rows: {
      id: string;
      name: string;
      fee_type: string;
      amount: string;
      class_name: string | null;
    }[] = await this.ds.query(
      `SELECT f.id, f.name, f.fee_type, f.amount, c.name AS class_name
         FROM fee_structures f
         JOIN academic_years y ON y.id = f.academic_year_id AND y.tenant_id = f.tenant_id
         LEFT JOIN classes c ON c.id = f.class_id AND c.tenant_id = f.tenant_id
        WHERE f.tenant_id = $1
          AND f.deleted_at IS NULL AND y.deleted_at IS NULL AND y.is_current = true
        ORDER BY c.name NULLS FIRST, f.fee_type, f.name, f.id
        LIMIT 200`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.fee_type,
      amount: Number(r.amount),
      className: r.class_name,
    }));
  }
}
