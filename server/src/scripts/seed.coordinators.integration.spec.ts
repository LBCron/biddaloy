import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { Teacher } from '../modules/academics/entities/teacher.entity';
import { ensureCoordinatorsSeed } from './seed.coordinators';
import { ASSISTANT_TEACHER_EMAIL, DEMO_ACADEMIC_YEAR, DEMO_CLASSES } from './seed.util';

/**
 * [83.3.4] D31: the dev seed's class coordinator (teacher@, Class 6 + 7) and Mathematics subject
 * coordinator (assistant-teacher@, Class 6). Each case uses its own school, so the shared seed
 * school is never touched.
 */
describe('ensureCoordinatorsSeed (integration)', () => {
  let ds: DataSource;
  const rand = () => Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  /** A school shaped like the dev seed: the demo year, its classes, MATH, the two teachers. */
  async function mkSchool(demoYearIsCurrent: boolean): Promise<string> {
    const [{ id: tenantId }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Coord Seed', $1) RETURNING id`,
      [`coord-seed-${rand()}`],
    );
    const [{ id: yearId }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ($1, '2026-01-01', '2026-12-31', $2, $3) RETURNING id`,
      [DEMO_ACADEMIC_YEAR.name, demoYearIsCurrent, tenantId],
    );
    if (!demoYearIsCurrent) {
      await ds.query(
        `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
         VALUES ('Another year', '2027-01-01', '2027-12-31', true, $1)`,
        [tenantId],
      );
    }
    for (const c of DEMO_CLASSES) {
      await ds.query(
        `INSERT INTO classes (tenant_id, name, academic_year_id, shift, version) VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, c.name, yearId, c.shift, c.version],
      );
    }
    await ds.query(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'Mathematics', 'MATH')`,
      [tenantId],
    );
    for (const email of ['teacher@biddaloy.test', ASSISTANT_TEACHER_EMAIL]) {
      const [existing] = await ds.query(`SELECT id FROM users WHERE email = $1`, [email]);
      const userId =
        existing?.id ??
        (
          await ds.query(
            `INSERT INTO users (email, full_name, status) VALUES ($1, 'Seed', 'ACTIVE') RETURNING id`,
            [email],
          )
        )[0].id;
      await ds.getRepository(Teacher).save({
        user_id: userId,
        employee_id: `EMP-CS-${rand()}`,
        tenant_id: tenantId,
        designations: [],
      });
    }
    return tenantId as string;
  }

  it('adds three rows on the seeded classes once, then none; a same-name class is left alone', async () => {
    const tenantId = await mkSchool(true);
    const seed6 = DEMO_CLASSES.find((c) => c.name === 'Class 6')!;
    // A developer's own "Class 6" on another shift, created first so it has the lower id.
    const [{ id: yearId }] = await ds.query(
      `SELECT id FROM academic_years WHERE tenant_id = $1 AND name = $2`,
      [tenantId, DEMO_ACADEMIC_YEAR.name],
    );
    const [{ id: decoy }] = await ds.query(
      `INSERT INTO classes (tenant_id, name, academic_year_id, shift, version)
       VALUES ($1, 'Class 6', $2, 'Evening', $3) RETURNING id`,
      [tenantId, yearId, seed6.version],
    );

    expect(await ensureCoordinatorsSeed(ds, tenantId)).toBe(3);
    expect(await ensureCoordinatorsSeed(ds, tenantId)).toBe(0);
    const rows = await ds.query(
      `SELECT c.id, c.name, c.shift, s.code FROM coordinator_assignments ca
         JOIN classes c ON c.id = ca.class_id LEFT JOIN subjects s ON s.id = ca.subject_id
        WHERE ca.tenant_id = $1 ORDER BY c.name, s.code NULLS FIRST`,
      [tenantId],
    );
    expect(rows.map((r: { name: string; code: string | null }) => [r.name, r.code])).toEqual([
      ['Class 6', null],
      ['Class 6', 'MATH'],
      ['Class 7', null],
    ]);
    expect(rows.some((r: { id: string }) => r.id === decoy)).toBe(false);
  });

  it('seeds nothing when another academic year is current', async () => {
    const tenantId = await mkSchool(false);
    expect(await ensureCoordinatorsSeed(ds, tenantId)).toBe(0);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM coordinator_assignments WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(n).toBe(0);
  });
});
