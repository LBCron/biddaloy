import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [8.15.48] Tenant indexes the system reports were missing (docs/architecture/33-reporting-load-test.md).
 * Every report reads `classes`, `class_sections` and (for a guardian phone) `guardians` with
 * `tenant_id = $1`, and none of the three had an index that starts with `tenant_id`, so each read
 * scanned the whole table, every school's rows included. The entities already declare these three
 * indexes (`@Index(['tenant_id'])`); the database never got them. The names below are the ones
 * TypeORM gives them, so the schema-drift baseline no longer lists them.
 * Indexes only: no table or column changes, so the demo seed is untouched.
 * CREATE INDEX blocks writes to the table while it builds (the repo never uses CONCURRENTLY);
 * fine at current sizes.
 */
export class ReportingIndexes1791900001400 implements MigrationInterface {
  name = 'ReportingIndexes1791900001400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_80e98e9a9146352f155f0bd3ad" ON "classes" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d6fa6a7e8bca2439a922182f0" ON "class_sections" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24430fa0e9c48d2ba41cf6312f" ON "guardians" ("tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_24430fa0e9c48d2ba41cf6312f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5d6fa6a7e8bca2439a922182f0"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_80e98e9a9146352f155f0bd3ad"`);
  }
}
