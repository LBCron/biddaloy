import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { ReportReaderRls1791900003200 } from '../src/migrations/1791900003200-ReportReaderRls';

/**
 * [#3521, D6] The RLS migration's `down` then `up` against the (already migrated) test database.
 * The role is cluster-wide: `down()` leaves it (other databases hold grants to it), and `up()` is
 * safe to run again over an existing role and existing policies.
 */
describe('ReportReaderRls1791900003200 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const migration = new ReportReaderRls1791900003200();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    // A failed step must not leave later spec files on this worker without the second wall.
    await migration.up(queryRunner);
    await queryRunner.release();
    await dataSource.destroy();
  });

  const state = async () => {
    const [row] = await dataSource.query(
      `SELECT (SELECT count(*)::int FROM pg_policies WHERE policyname = 'report_tenant') AS policies,
              (SELECT relrowsecurity FROM pg_class WHERE oid = 'students'::regclass) AS rls,
              (SELECT count(*)::int FROM pg_roles WHERE rolname = 'report_reader') AS role`,
    );
    return row as { policies: number; rls: boolean; role: number };
  };

  it('down() removes policies and RLS but keeps the role; up() twice is harmless', async () => {
    await migration.down(queryRunner);
    expect(await state()).toMatchObject({ policies: 0, rls: false, role: 1 });
    await migration.up(queryRunner);
    const first = await state();
    expect(first).toMatchObject({ rls: true, role: 1 });
    expect(first.policies).toBeGreaterThan(20);
    await migration.up(queryRunner);
    expect(await state()).toEqual(first);
  });
});
