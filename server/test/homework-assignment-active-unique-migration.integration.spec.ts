import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, type QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { withMigrationsReverted } from '@test/helpers/db.helper';
import { HomeworkAssignmentActiveUnique1791900001100 } from '../src/migrations/1791900001100-HomeworkAssignmentActiveUnique';

/**
 * [3172] One ACTIVE assignment per (homework, target). Existing duplicates are cleaned by the
 * migration (newest ACTIVE kept, older ones DEACTIVATED, nothing deleted), then the DB refuses
 * a second ACTIVE row; DEACTIVATED / SUPERSEDED rows never collide.
 */
describe('HomeworkAssignmentActiveUnique migration (integration)', { timeout: 30000 }, () => {
  let ds: DataSource;
  const migration = new HomeworkAssignmentActiveUnique1791900001100();
  const schoolIds: string[] = [];
  // A runner holds a pool connection from its first query until release(); an unreleased one
  // keeps ds.destroy() in afterAll waiting.
  const withRunner = async (fn: (qr: QueryRunner) => Promise<void>) => {
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      await fn(qr);
    } finally {
      await qr.release();
    }
  };

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get(DataSource);
  }, 60000);

  afterAll(async () => {
    if (schoolIds.length) {
      for (const t of [
        'homework_assignments',
        'homework',
        'students',
        'class_sections',
        'classes',
        'subjects',
        'academic_years',
      ]) {
        await ds.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [schoolIds]);
      }
      await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [schoolIds]);
    }
    await ds.destroy();
  });

  /** A school with one homework, one section and one student. */
  const mkWorld = async () => {
    const tenant = randomUUID();
    schoolIds.push(tenant);
    await ds.query(`INSERT INTO schools (id, name, slug) VALUES ($1, $2, $3)`, [
      tenant,
      `S ${tenant}`,
      `s-${tenant}`,
    ]);
    const [year] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('Y', '3001-01-01', '3001-12-31', $1) RETURNING id`,
      [tenant],
    );
    const [klass] = await ds.query(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('C', $1, $2) RETURNING id`,
      [year.id, tenant],
    );
    const [section] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [klass.id, tenant],
    );
    const [student] = await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ('Dup Student', $1, 1, $2, $3) RETURNING id`,
      [`DUP-${tenant.slice(0, 8)}`, section.id, tenant],
    );
    const [subject] = await ds.query(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'Subj', $2) RETURNING id`,
      [tenant, `DUP-${tenant.slice(0, 8)}`],
    );
    const [hw] = await ds.query(
      `INSERT INTO homework (title, class_id, subject_id, grading_mode, tenant_id)
       VALUES ('HW', $1, $2, 'TICK', $3) RETURNING id`,
      [klass.id, subject.id, tenant],
    );
    return {
      tenant,
      section: section.id as string,
      student: student.id as string,
      hw: hw.id as string,
    };
  };

  const insert = async (
    w: { tenant: string; hw: string },
    target: { section?: string; student?: string },
    status: string,
    createdAt: string,
  ) => {
    const [row] = await ds.query(
      `INSERT INTO homework_assignments
         (homework_id, section_id, student_id, assigned_date, due_date, status, tenant_id, created_at)
       VALUES ($1, $2, $3, '3001-01-01', '3001-01-08', $4, $5, $6) RETURNING id`,
      [w.hw, target.section ?? null, target.student ?? null, status, w.tenant, createdAt],
    );
    return row.id as string;
  };
  const statusOf = async (id: string) =>
    (await ds.query(`SELECT status FROM homework_assignments WHERE id = $1`, [id]))[0].status;

  it('refuses a second ACTIVE row for one section or one student; other statuses never clash', async () => {
    const w = await mkWorld();
    await insert(w, { section: w.section }, 'ACTIVE', '3001-01-01');
    await expect(insert(w, { section: w.section }, 'ACTIVE', '3001-01-02')).rejects.toMatchObject({
      code: '23505',
    });
    await insert(w, { section: w.section }, 'DEACTIVATED', '3001-01-02');
    await insert(w, { section: w.section }, 'SUPERSEDED', '3001-01-03');

    await insert(w, { student: w.student }, 'ACTIVE', '3001-01-01');
    await expect(insert(w, { student: w.student }, 'ACTIVE', '3001-01-02')).rejects.toMatchObject({
      code: '23505',
    });
    // The same target on ANOTHER homework is a different assignment.
    const other = await ds.query(
      `INSERT INTO homework (title, class_id, subject_id, grading_mode, tenant_id)
       SELECT 'HW2', class_id, subject_id, 'TICK', tenant_id FROM homework WHERE id = $1 RETURNING id`,
      [w.hw],
    );
    await insert(
      { tenant: w.tenant, hw: other[0].id },
      { section: w.section },
      'ACTIVE',
      '3001-01-01',
    );
  });

  it('up keeps the newest ACTIVE duplicate per target, deactivates the older ones and deletes nothing', async () => {
    const w = await mkWorld();
    await withMigrationsReverted(ds, [migration], async () => {
      // Index is gone: duplicates can exist, exactly as in an existing school.
      const oldSec = await insert(w, { section: w.section }, 'ACTIVE', '3001-01-01');
      const midSec = await insert(w, { section: w.section }, 'ACTIVE', '3001-01-02');
      const newSec = await insert(w, { section: w.section }, 'ACTIVE', '3001-01-03');
      const supersededSec = await insert(w, { section: w.section }, 'SUPERSEDED', '3001-01-04');
      const oldStu = await insert(w, { student: w.student }, 'ACTIVE', '3001-01-01');
      const newStu = await insert(w, { student: w.student }, 'ACTIVE', '3001-01-02');

      await withRunner((qr) => migration.up(qr));

      expect(await statusOf(newSec)).toBe('ACTIVE');
      expect(await statusOf(midSec)).toBe('DEACTIVATED');
      expect(await statusOf(oldSec)).toBe('DEACTIVATED');
      expect(await statusOf(supersededSec)).toBe('SUPERSEDED');
      expect(await statusOf(newStu)).toBe('ACTIVE');
      expect(await statusOf(oldStu)).toBe('DEACTIVATED');
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM homework_assignments WHERE homework_id = $1`,
        [w.hw],
      );
      expect(n).toBe(6);
      // The helper runs up() again afterwards; take the indexes down so that re-run is clean.
      await withRunner((qr) => migration.down(qr));
    });
  });
});
