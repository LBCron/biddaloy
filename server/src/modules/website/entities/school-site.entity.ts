import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { SiteConfig } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';

/**
 * [40.1.03] One public website per school. CHECKs and uniques mirror the
 * migration `SchoolWebsite1791900003400`.
 *
 * Rule 27 (delete guards) for the whole website module, answered once here:
 *  - `schools` -> `school_sites` / `site_media` / `site_posts` / `site_enquiries` /
 *    `staff_web_profiles`: ON DELETE CASCADE. A school's website data has no meaning without
 *    the school, so a HARD school delete takes it along; no `assertNoLiveDependents` needed.
 *  - `users` -> `staff_web_profiles`: ON DELETE CASCADE, HARD delete only.
 *  - `site_media` -> `site_posts.cover_media_id` and `staff_web_profiles.photo_media_id`:
 *    ON DELETE SET NULL. Deleting a picture clears the cover/photo and never blocks.
 *  So there is no RESTRICT FK and no live-dependent guard to register.
 *
 *  WARNING: `schools` and `users` are SOFT-deleted (`deleted_at`) and "removing staff" means
 *  losing the membership, so the cascades above never fire in normal use. Every public read
 *  of this module MUST itself filter on the school's `deleted_at`, `users.deleted_at` and an
 *  active membership, or a removed teacher with `show_on_website = true` stays public.
 *  The staff public-read ticket owns that filter. The picture FKs are composite
 *  `(tenant_id, media_id)`, so the DB itself refuses another school's picture.
 */
@Unique('UQ_school_sites_tenant_id', ['tenant_id'])
@Unique('UQ_school_sites_subdomain', ['subdomain'])
@Unique('UQ_school_sites_previous_subdomain', ['previous_subdomain'])
@Unique('UQ_school_sites_custom_domain', ['custom_domain'])
@Check('CHK_school_sites_subdomain', `"subdomain" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'`)
@Check('CHK_school_sites_media_bytes_used', `"media_bytes_used" >= 0`)
@Check('CHK_school_sites_custom_domain_lower', `"custom_domain" = lower("custom_domain")`)
@Entity('school_sites')
export class SchoolSite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @OneToOne(() => School, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'FK_school_sites_tenant_id' })
  tenant: School;

  @Column({ type: 'varchar', length: 30 })
  subdomain: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  previous_subdomain: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  previous_until: Date | null;

  @Column({ type: 'varchar', length: 253, nullable: true })
  custom_domain: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  custom_domain_status: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  custom_domain_external_id: string | null;

  /** DNS records the admin must add: `[{ type, name, value }]`. */
  @Column({ type: 'jsonb', nullable: true })
  custom_domain_records: { type: 'CNAME' | 'TXT'; name: string; value: string }[] | null;

  /** When the status last changed; a PENDING_* status older than 7 days becomes FAILED. */
  @Column({ type: 'timestamptz', nullable: true })
  custom_domain_since: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  custom_domain_checked_at: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'basic' })
  theme: string;

  @Column({ type: 'varchar', length: 40 })
  palette: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'boolean', default: false })
  noindex: boolean;

  @Column({ type: 'jsonb' })
  draft: SiteConfig;

  @Column({ type: 'jsonb', nullable: true })
  published: SiteConfig | null;

  /** Bumped on every publish; the public cache key. */
  @Column({ type: 'int', default: 0 })
  version: number;

  /** Bumped on every draft save, so a stale save or a publish of an unseen draft is 409. */
  @Column({ type: 'int', default: 0 })
  draft_revision: number;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  umami_website_id: string | null;

  // bigint comes back from pg as a string
  @Column({ type: 'bigint', default: 0 })
  media_bytes_used: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
