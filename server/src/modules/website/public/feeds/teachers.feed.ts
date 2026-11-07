import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Feed, FeedOpts, FeedRow } from './feed-registry';

/**
 * Teachers and staff the admin chose to show (`show_on_website`), featured first, then the
 * admin's `sort_order`. Only a person who is still a live teacher/staff member of THIS school
 * appears; a removed or suspended account drops out even if their card is still ticked.
 * The user table has one name, so `name` is that name in both languages.
 */
@Injectable()
export class TeachersFeed implements Feed {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async load(tenantId: string, opts: FeedOpts = {}): Promise<FeedRow[]> {
    const rows: {
      user_id: string;
      full_name: string;
      featured: boolean;
      subjects: string[];
      bio: Record<string, string> | null;
      credentials: Record<string, string> | null;
      photo_media_id: string | null;
      title_en: string | null;
      title_bn: string | null;
    }[] = await this.ds.query(
      `SELECT p.user_id, u.full_name, p.featured, p.subjects, p.bio, p.credentials, p.photo_media_id,
              d.title_en, d.title_bn
         FROM staff_web_profiles p
         JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
         LEFT JOIN staff_designation_history h
                ON h.user_id = p.user_id AND h.tenant_id = p.tenant_id AND h.end_date IS NULL
         LEFT JOIN designations d ON d.id = h.designation_id AND d.deleted_at IS NULL
        WHERE p.tenant_id = $1 AND p.show_on_website = true
          AND EXISTS (SELECT 1 FROM user_tenants m
                       WHERE m.user_id = p.user_id AND m.tenant_id = p.tenant_id
                         AND m.deleted_at IS NULL AND m.role IN ('TEACHER','OFFICE_STAFF'))
        ORDER BY p.featured DESC, p.sort_order, u.full_name, u.id
        LIMIT $2`,
      [tenantId, opts.limit ?? 200],
    );
    return rows.map((r) => ({
      id: r.user_id,
      name: { bn: r.full_name, en: r.full_name },
      designation:
        r.title_en || r.title_bn
          ? { bn: r.title_bn ?? r.title_en, en: r.title_en ?? r.title_bn }
          : null,
      subjects: r.subjects,
      bio: r.bio,
      credentials: r.credentials,
      featured: r.featured,
      photo: r.photo_media_id,
    }));
  }
}
