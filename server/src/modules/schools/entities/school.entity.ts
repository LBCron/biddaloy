import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  Check,
} from 'typeorm';
import { SchoolStatus } from '@biddaloy/shared';

/**
 * A school / tenant in the multi-tenant system.
 *
 * Each school operates independently with its own classes, students,
 * fee structures, and users. A single user can belong to multiple
 * schools with different roles (e.g., Teacher in School A, Guardian in School B).
 *
 * Relations:
 * - Referenced-by → UserTenant: membership linking users to this school
 * - Referenced-by → AcademicYear: academic years are school-scoped
 * - Referenced-by → Class: classes are school-scoped
 * - Referenced-by → Teacher: teachers are school-scoped
 * - Referenced-by → Student: students are school-scoped
 */
@Entity('schools')
@Index(['slug'], { unique: true })
@Check('CHK_schools_seat_limit', '"seat_limit" >= 0')
export class School {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  email: string | null;

  /** Localized (Bengali) school name — [15.5.1]. Nullable: falls back to
   * `name` wherever a bn-first display is needed but this is unset. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  name_bn: string | null;

  /** EIIN or other registration id shown on official documents —
   * [15.5.1]. Nullable, no format enforced (varies by school type). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  registration_id: string | null;

  /** Storage key of the current logo object, or null if none uploaded —
   * [15.5.1]. Never exposed directly; served through `/schools/:id/logo`
   * ([15.5.4]) and used to build `logo_url` ([15.5.2]). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  logo_key: string | null;

  @Column({ type: 'jsonb', nullable: true })
  settings: Record<string, any> | null;

  /**
   * Lifecycle status (15.4). Plain `varchar` with a DB check constraint —
   * not a Postgres `enum` type — so it stays cheap to extend. `SUSPENDED`
   * is a SUPER_ADMIN access gate, distinct from `deleted_at` soft delete.
   */
  @Column({ type: 'varchar', length: 20, default: SchoolStatus.ACTIVE })
  status: 'ACTIVE' | 'SUSPENDED';

  @Column({ type: 'text', nullable: true })
  status_reason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  status_changed_at: Date | null;

  /** ISO 3166-1 alpha-2 country the school registered from [13.1.2]. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  country_code: string | null;

  /** Trial end; NULL = no trial. */
  @Column({ type: 'timestamptz', nullable: true })
  trial_ends_at: Date | null;

  /** Max active seats; NULL = unlimited. DB CHECK >= 0. */
  @Column({ type: 'integer', nullable: true })
  seat_limit: number | null;

  /** Onboarding state; `finished_at` set once done (existing schools backfilled). */
  @Column({ type: 'jsonb', nullable: true })
  onboarding: Record<string, any> | null;

  /** True when a visitor registered this school on the public demo deployment (Epic 88 D3). */
  @Column({ type: 'boolean', default: false })
  created_in_demo: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at: Date | null;
}
