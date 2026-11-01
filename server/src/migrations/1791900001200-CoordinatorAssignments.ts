import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [83.1.2] `coordinator_assignments`: which teacher coordinates which class, optionally for one
 * subject (Epic 83 D2, D3). See `CoordinatorAssignment` for the why.
 *
 * - `UQ_coordinator_assignment` is `NULLS NOT DISTINCT` (PG15+, D11): a second class-level row
 *   (subject NULL) for the same (tenant, teacher, class) collides, like a second subject row.
 *   TypeORM cannot express it, so the entity does not declare it (schema-drift baseline).
 * - "subject belongs to the same tenant" cannot be a CHECK; `CoordinatorsService` enforces it.
 * - FK and PK names are TypeORM's own hashed names, so the entity shows no drift.
 *
 * `down()` drops the table; it works on an empty database.
 */
export class CoordinatorAssignments1791900001200 implements MigrationInterface {
  name = 'CoordinatorAssignments1791900001200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "coordinator_assignments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "teacher_id" uuid NOT NULL,
        "class_id" uuid NOT NULL,
        "subject_id" uuid,
        "assigned_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_303cf4cc2696839ef3c8d1ecb66" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_coordinator_assignment" ON "coordinator_assignments" ("tenant_id", "teacher_id", "class_id", "subject_id") NULLS NOT DISTINCT`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca_tenant_teacher" ON "coordinator_assignments" ("tenant_id", "teacher_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ca_tenant_class" ON "coordinator_assignments" ("tenant_id", "class_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "coordinator_assignments" ADD CONSTRAINT "FK_0b9c082a67534f9d68dbfd52c83" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coordinator_assignments" ADD CONSTRAINT "FK_c86c7c3cbafacc6e7687c1458dd" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coordinator_assignments" ADD CONSTRAINT "FK_0c727a5f71b17d817533fbaa67c" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coordinator_assignments" ADD CONSTRAINT "FK_cab9cb188ac24990c58c6322791" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "coordinator_assignments" ADD CONSTRAINT "FK_941554fbfd4d4f46e204991b1a5" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "coordinator_assignments"`);
  }
}
