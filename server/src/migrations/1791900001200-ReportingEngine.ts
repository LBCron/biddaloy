import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [8.15.9] Reporting engine tables (Epic 8.15 D3, D6, D8, D24): report
 * definitions, immutable published versions, runs, schedules and snapshots.
 * Every table carries `tenant_id` with a tenant-led index. A published version
 * can never change (trigger), and a version, run or snapshot survives its
 * definition being soft-deleted (RESTRICT FKs).
 * Workbook: definitions, versions and schedules get a tab in [8.15.12]; runs
 * and snapshots are derived output and stay exempt. Demo seed: [8.15.32].
 */
export class ReportingEngine1791900001200 implements MigrationInterface {
  name = 'ReportingEngine1791900001200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "report_definitions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "key" character varying(80) NOT NULL, "name_en" character varying(160) NOT NULL, "name_bn" character varying(160) NOT NULL, "folder" character varying(80), "status" character varying(20) NOT NULL DEFAULT 'DRAFT', "visible_roles" text array NOT NULL DEFAULT '{}', "current_version_id" uuid, "system_template_key" character varying(80), "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_fa3c447eb43b86f206b4f54f033" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_report_definitions_tenant_key" ON "report_definitions" ("tenant_id", "key") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a9d0616fa777a780beaee0084" ON "report_definitions" ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "report_definition_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "definition_id" uuid NOT NULL, "version" integer NOT NULL, "definition" jsonb NOT NULL, "schema_version" integer NOT NULL, "published_by" uuid, "published_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4520379a0b7555c697c41d3257f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_report_definition_versions_definition_version" ON "report_definition_versions" ("definition_id", "version") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58373f20408be3610989665730" ON "report_definition_versions" ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "report_runs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "definition_version_id" uuid, "source_key" character varying(80), "kind" character varying(20) NOT NULL, "status" character varying(20) NOT NULL, "format" character varying(10), "params" jsonb NOT NULL DEFAULT '{}', "row_count" integer NOT NULL DEFAULT '0', "duration_ms" integer NOT NULL DEFAULT '0', "storage_key" text, "expires_at" TIMESTAMP WITH TIME ZONE, "error_code" character varying(40), "helpful" boolean, "feedback_comment" character varying(500), "feedback_at" TIMESTAMP WITH TIME ZONE, "run_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ec9cd6617ae677b28700451a9b3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_report_runs_tenant_created" ON "report_runs" ("tenant_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "report_snapshots" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "run_id" uuid NOT NULL, "definition_version_id" uuid NOT NULL, "as_of" date NOT NULL, "label" character varying(160) NOT NULL, "storage_key" text NOT NULL, "row_count" integer NOT NULL DEFAULT '0', "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b72010989c40cd0883ed90f674a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_efe3e1f1af7348154d8f891339" ON "report_snapshots" ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "report_schedules" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "definition_id" uuid NOT NULL, "frequency" character varying(20) NOT NULL, "day_of_week" smallint, "day_of_month" smallint, "local_time" character varying(5) NOT NULL, "params" jsonb NOT NULL DEFAULT '{}', "recipient_roles" text array NOT NULL DEFAULT '{}', "format" character varying(10) NOT NULL, "active" boolean NOT NULL DEFAULT true, "last_run_id" uuid, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_603f9cdaaf4c1193d7399c1e79c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c986cfd5db47ed85be1e4828b" ON "report_schedules" ("tenant_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definitions" ADD CONSTRAINT "FK_9a9d0616fa777a780beaee00843" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definitions" ADD CONSTRAINT "FK_ff16c42094af9630c18bc9b82e5" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definition_versions" ADD CONSTRAINT "FK_58373f20408be36109896657301" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definition_versions" ADD CONSTRAINT "FK_b83f1cf2549d256d58fe41a7b19" FOREIGN KEY ("definition_id") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definition_versions" ADD CONSTRAINT "FK_cb9dbdd2a75883c97df56ff4845" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_runs" ADD CONSTRAINT "FK_121e61173eb8bac80f7b14763d0" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_runs" ADD CONSTRAINT "FK_2f728b184e3046ac8efee6bcfcc" FOREIGN KEY ("definition_version_id") REFERENCES "report_definition_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_runs" ADD CONSTRAINT "FK_db139865be46e40cc57e921502c" FOREIGN KEY ("run_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_snapshots" ADD CONSTRAINT "FK_efe3e1f1af7348154d8f8913391" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_snapshots" ADD CONSTRAINT "FK_5fddba42db0f0e19e240cf3641b" FOREIGN KEY ("run_id") REFERENCES "report_runs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_snapshots" ADD CONSTRAINT "FK_7771c7a39e7d827120d244e43d8" FOREIGN KEY ("definition_version_id") REFERENCES "report_definition_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_snapshots" ADD CONSTRAINT "FK_0de859b003f311f9e12738f01c9" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_schedules" ADD CONSTRAINT "FK_5c986cfd5db47ed85be1e4828b5" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_schedules" ADD CONSTRAINT "FK_3e212aa543880d14d611e7e2479" FOREIGN KEY ("definition_id") REFERENCES "report_definitions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_schedules" ADD CONSTRAINT "FK_aa48ea8f7fd3b5b4c61535d76df" FOREIGN KEY ("last_run_id") REFERENCES "report_runs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_schedules" ADD CONSTRAINT "FK_61ed2007e84f2a0312ce69cd7c8" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION "public"."block_report_definition_versions_update"() RETURNS TRIGGER AS $$ BEGIN IF OLD.published_by IS NOT NULL AND NEW.published_by IS NULL AND (to_jsonb(NEW) - 'published_by') = (to_jsonb(OLD) - 'published_by') THEN RETURN NEW; END IF; RAISE EXCEPTION 'report_definition_versions is immutable: updates are not permitted'; END; $$ LANGUAGE plpgsql`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "trg_report_definition_versions_immutable" BEFORE UPDATE ON "report_definition_versions" FOR EACH ROW EXECUTE FUNCTION "public"."block_report_definition_versions_update"()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "trg_report_definition_versions_immutable" ON "report_definition_versions"`,
    );
    await queryRunner.query(`DROP FUNCTION "public"."block_report_definition_versions_update"()`);
    await queryRunner.query(
      `ALTER TABLE "report_schedules" DROP CONSTRAINT "FK_61ed2007e84f2a0312ce69cd7c8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_schedules" DROP CONSTRAINT "FK_aa48ea8f7fd3b5b4c61535d76df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_schedules" DROP CONSTRAINT "FK_3e212aa543880d14d611e7e2479"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_schedules" DROP CONSTRAINT "FK_5c986cfd5db47ed85be1e4828b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_snapshots" DROP CONSTRAINT "FK_0de859b003f311f9e12738f01c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_snapshots" DROP CONSTRAINT "FK_7771c7a39e7d827120d244e43d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_snapshots" DROP CONSTRAINT "FK_5fddba42db0f0e19e240cf3641b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_snapshots" DROP CONSTRAINT "FK_efe3e1f1af7348154d8f8913391"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_runs" DROP CONSTRAINT "FK_db139865be46e40cc57e921502c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_runs" DROP CONSTRAINT "FK_2f728b184e3046ac8efee6bcfcc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_runs" DROP CONSTRAINT "FK_121e61173eb8bac80f7b14763d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definition_versions" DROP CONSTRAINT "FK_cb9dbdd2a75883c97df56ff4845"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definition_versions" DROP CONSTRAINT "FK_b83f1cf2549d256d58fe41a7b19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definition_versions" DROP CONSTRAINT "FK_58373f20408be36109896657301"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definitions" DROP CONSTRAINT "FK_ff16c42094af9630c18bc9b82e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_definitions" DROP CONSTRAINT "FK_9a9d0616fa777a780beaee00843"`,
    );
    await queryRunner.query(`DROP TABLE "report_schedules"`);
    await queryRunner.query(`DROP TABLE "report_snapshots"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_report_runs_tenant_created"`);
    await queryRunner.query(`DROP TABLE "report_runs"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_report_definition_versions_definition_version"`,
    );
    await queryRunner.query(`DROP TABLE "report_definition_versions"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_report_definitions_tenant_key"`);
    await queryRunner.query(`DROP TABLE "report_definitions"`);
  }
}
