import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [76.1.02] Attendance card numbers on students and staff profiles (partial unique per
 * school, live rows only) and the `attendance_imports` upload history. `down()` works on an
 * empty database.
 */
export class Epic76AttendanceSourceCards1791900003300 implements MigrationInterface {
  name = 'Epic76AttendanceSourceCards1791900003300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" ADD "card_no" varchar(64)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_students_tenant_card_no" ON "students" ("tenant_id", "card_no") WHERE "card_no" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "staff_profiles" ADD "card_no" varchar(64)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_staff_profiles_tenant_card_no" ON "staff_profiles" ("tenant_id", "card_no") WHERE "card_no" IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE "attendance_imports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "uploaded_by_user_id" uuid,
        "file_name" varchar(255) NOT NULL,
        "rows" jsonb NOT NULL,
        "count_new" int NOT NULL DEFAULT 0,
        "count_changed" int NOT NULL DEFAULT 0,
        "count_unchanged" int NOT NULL DEFAULT 0,
        "count_error" int NOT NULL DEFAULT 0,
        "supersedes_import_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_imports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_7a7ebcdc6a410ed69382d546ba2" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_6b089720a5c0589c6e2b71d3e97" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_2e57478d9e76bc6af29442b98d1" FOREIGN KEY ("supersedes_import_id") REFERENCES "attendance_imports"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_attendance_imports_tenant_created" ON "attendance_imports" ("tenant_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "attendance_imports"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_staff_profiles_tenant_card_no"`);
    await queryRunner.query(`ALTER TABLE "staff_profiles" DROP COLUMN "card_no"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_students_tenant_card_no"`);
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "card_no"`);
  }
}
