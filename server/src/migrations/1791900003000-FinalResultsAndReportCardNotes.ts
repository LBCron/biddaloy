import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [70.1.2] Epic 70 tables: `final_results`, `final_result_weights`, `final_result_rows`,
 * `final_result_subjects`, `report_card_notes`. See the entities for the why.
 *
 * - `UQ_final_result_weights_natural` and `UQ_report_card_notes_target` are
 *   `NULLS NOT DISTINCT` (PG15+, Epic 33 precedent): TypeORM cannot express them, so the
 *   entities do not declare them (schema-drift baseline).
 * - `final_result_weights.exam_id` and `final_result_rows.grading_scale_id` are NO ACTION,
 *   not RESTRICT (same reasoning as `FK_results_grading_scale`).
 * - FK, PK and index names are TypeORM's own, so the entities show no drift.
 *
 * `down()` drops the tables and enums; it works on an empty database.
 */
export class FinalResultsAndReportCardNotes1791900003000 implements MigrationInterface {
  name = 'FinalResultsAndReportCardNotes1791900003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."final_results_status_enum" AS ENUM('DRAFT', 'PROCESSED', 'PUBLISHED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."final_results_mode_enum" AS ENUM('WEIGHTED', 'BEST_OF')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."final_results_rounding_enum" AS ENUM('WHOLE', 'TWO_DECIMALS')`,
    );
    await queryRunner.query(
      `CREATE TABLE "final_results" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "class_id" uuid NOT NULL, "academic_year_id" uuid NOT NULL, "status" "public"."final_results_status_enum" NOT NULL DEFAULT 'DRAFT', "mode" "public"."final_results_mode_enum" NOT NULL DEFAULT 'WEIGHTED', "best_of_count" integer, "rounding" "public"."final_results_rounding_enum" NOT NULL DEFAULT 'WHOLE', "fail_if_any_exam_fails" boolean NOT NULL DEFAULT false, "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_final_results_best_of_mode" CHECK ("best_of_count" IS NULL OR ("mode" = 'BEST_OF' AND "best_of_count" >= 1)), CONSTRAINT "PK_7d47fdf5ace2a4523a0094fae91" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0a399d88dfd8d0ab2453810789" ON "final_results" ("tenant_id", "class_id", "academic_year_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "report_card_notes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "student_id" uuid NOT NULL, "exam_id" uuid, "final_result_id" uuid, "remark" character varying(300), "conduct" jsonb NOT NULL DEFAULT '{}', "updated_by_user_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_report_card_notes_one_target" CHECK (num_nonnulls("exam_id", "final_result_id") = 1), CONSTRAINT "PK_636f3a8a18fa8ab75f15d41e04a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rcn_tenant_exam" ON "report_card_notes" ("tenant_id", "exam_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rcn_tenant_final_result" ON "report_card_notes" ("tenant_id", "final_result_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "final_result_weights" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "final_result_id" uuid NOT NULL, "exam_id" uuid NOT NULL, "subject_id" uuid, "share_percent" numeric(5,2) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_final_result_weights_share_range" CHECK ("share_percent" >= 0 AND "share_percent" <= 100), CONSTRAINT "PK_0dd65c60df1201ba5b0002eb3da" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_frw_exam" ON "final_result_weights" ("exam_id") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_frw_tenant_final_result" ON "final_result_weights" ("tenant_id", "final_result_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "final_result_rows" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "final_result_id" uuid NOT NULL, "student_id" uuid NOT NULL, "total_marks" numeric(8,2) NOT NULL, "gpa" numeric(4,2) NOT NULL, "grade" character varying(10) NOT NULL, "position" integer, "section_id" uuid, "section_position" integer, "is_fail" boolean NOT NULL DEFAULT false, "grading_scale_id" uuid NOT NULL, "grading_scale_revision" integer NOT NULL, "rule_version" character varying(50) NOT NULL, "computed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE, "working_days" integer, "present_days" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_final_result_rows_days" CHECK (("working_days" IS NULL OR "working_days" >= 0) AND ("present_days" IS NULL OR "present_days" >= 0) AND ("working_days" IS NULL OR "present_days" IS NULL OR "present_days" <= "working_days")), CONSTRAINT "PK_8c9b9b5b9d3b8a9e53bd75f396f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7fb3e7000bb143aa17a30f737f" ON "final_result_rows" ("final_result_id", "section_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4f99358d7b742693e4e99b9883" ON "final_result_rows" ("final_result_id", "student_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84d400bc4907045ff86db6235c" ON "final_result_rows" ("tenant_id", "final_result_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "final_result_subjects" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "final_result_row_id" uuid NOT NULL, "subject_id" uuid NOT NULL, "obtained" numeric(6,2) NOT NULL, "grade" character varying(10) NOT NULL, "gpa" numeric(4,2) NOT NULL, "is_fail" boolean NOT NULL DEFAULT false, "is_fourth_subject" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7a5cf26d7acf24fa78d784a148f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_efd5ff40acf8be4c24f93c06e1" ON "final_result_subjects" ("final_result_row_id", "subject_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43285a32d1fa873838bd85b052" ON "final_result_subjects" ("tenant_id", "final_result_row_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "final_results" ADD CONSTRAINT "FK_4226acf39307ed8911cc86f2601" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_results" ADD CONSTRAINT "FK_f50e8a15f8384ae633940933434" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_results" ADD CONSTRAINT "FK_952dcbd1d7ab61387939214c94f" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_card_notes" ADD CONSTRAINT "FK_925fedf0089aa26caebfacc318f" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_card_notes" ADD CONSTRAINT "FK_87ebe237e2b03b8e8ea702bf93e" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_card_notes" ADD CONSTRAINT "FK_1f6f4024f130c898d93322258cd" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_card_notes" ADD CONSTRAINT "FK_68cb4d13fc90fd28ac9bdd9a200" FOREIGN KEY ("final_result_id") REFERENCES "final_results"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_card_notes" ADD CONSTRAINT "FK_5798c5221b0cffbda6d8f0b358c" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_weights" ADD CONSTRAINT "FK_e25819d856b0ceb5621c043d079" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_weights" ADD CONSTRAINT "FK_73174d243b28805d82db7869af5" FOREIGN KEY ("final_result_id") REFERENCES "final_results"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_weights" ADD CONSTRAINT "FK_ce3955eb303b44e6aaed4a822bb" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_weights" ADD CONSTRAINT "FK_1b3274b32027c9c8d95a2518a4e" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_rows" ADD CONSTRAINT "FK_7a241ad9e60a42f148079a7addc" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_rows" ADD CONSTRAINT "FK_4e51ff9c4ffa506926992e63353" FOREIGN KEY ("final_result_id") REFERENCES "final_results"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_rows" ADD CONSTRAINT "FK_6366dd0a31bdce70239d4a2de06" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_rows" ADD CONSTRAINT "FK_a4c13f0f4d9e18b5b7cf05a6ef6" FOREIGN KEY ("section_id") REFERENCES "class_sections"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_rows" ADD CONSTRAINT "FK_c756254964f92b607b0befb74f4" FOREIGN KEY ("grading_scale_id") REFERENCES "grading_scales"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_subjects" ADD CONSTRAINT "FK_792e337f9c75f335502a376456c" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_subjects" ADD CONSTRAINT "FK_f28d6fe968cc14ad9a2b1fa553a" FOREIGN KEY ("final_result_row_id") REFERENCES "final_result_rows"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "final_result_subjects" ADD CONSTRAINT "FK_0d43af7ce6b05b8ee8b7a163973" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_final_result_weights_natural" ON "final_result_weights" ("final_result_id", "exam_id", "subject_id") NULLS NOT DISTINCT`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_report_card_notes_target" ON "report_card_notes" ("student_id", "exam_id", "final_result_id") NULLS NOT DISTINCT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "report_card_notes"`);
    await queryRunner.query(`DROP TABLE "final_result_subjects"`);
    await queryRunner.query(`DROP TABLE "final_result_rows"`);
    await queryRunner.query(`DROP TABLE "final_result_weights"`);
    await queryRunner.query(`DROP TABLE "final_results"`);
    await queryRunner.query(`DROP TYPE "public"."final_results_rounding_enum"`);
    await queryRunner.query(`DROP TYPE "public"."final_results_mode_enum"`);
    await queryRunner.query(`DROP TYPE "public"."final_results_status_enum"`);
  }
}
