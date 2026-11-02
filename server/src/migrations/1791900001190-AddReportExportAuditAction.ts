import { MigrationInterface, QueryRunner } from 'typeorm';

/** [8.15.10] `REPORT_EXPORT` — written once per report or list export, with the
 * format and row count (never the rows). See `AuditAction` in
 * `shared/src/enums/index.ts`. */
export class AddReportExportAuditAction1791900001190 implements MigrationInterface {
  name = 'AddReportExportAuditAction1791900001190';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE 'REPORT_EXPORT'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no `ALTER TYPE ... DROP VALUE`: recreate the type from its
    // current labels minus REPORT_EXPORT. Fails loudly if a row still uses it.
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_action_enum" RENAME TO "audit_logs_action_enum_old"`,
    );
    await queryRunner.query(`DO $$
      DECLARE labels text;
      BEGIN
        SELECT string_agg(quote_literal(enumlabel), ', ' ORDER BY enumsortorder) INTO labels
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'audit_logs_action_enum_old' AND enumlabel <> 'REPORT_EXPORT';
        EXECUTE 'CREATE TYPE "public"."audit_logs_action_enum" AS ENUM(' || labels || ')';
      END $$`);
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "public"."audit_logs_action_enum" USING "action"::text::"public"."audit_logs_action_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum_old"`);
  }
}
