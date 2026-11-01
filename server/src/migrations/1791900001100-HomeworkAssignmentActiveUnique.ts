import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [3172] One ACTIVE assignment per (homework, target). Nothing stopped `assign()` or a
 * reactivate from leaving two ACTIVE rows for the same section (or student) of one homework, so
 * families saw it twice and every rate counted it twice. Two partial unique indexes now refuse
 * the second ACTIVE row; a DEACTIVATED or SUPERSEDED row never collides.
 *
 * `up()` first cleans existing duplicates so the index can be built: per target it keeps the
 * newest ACTIVE row (latest `created_at`, then `id`) and sets the older ones to DEACTIVATED.
 * That is the undoable status: no row is deleted and every submission stays on its row.
 * No table or column changes; the demo seed has one ACTIVE assignment per target and needs no
 * change.
 *
 * `down()` drops the indexes. The dedupe is not undone (it cannot know which rows it changed).
 */
const SECTION_INDEX = 'IDX_homework_assignments_active_section';
const STUDENT_INDEX = 'IDX_homework_assignments_active_student';

export class HomeworkAssignmentActiveUnique1791900001100 implements MigrationInterface {
  name = 'HomeworkAssignmentActiveUnique1791900001100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const target of ['section_id', 'student_id']) {
      await queryRunner.query(
        `UPDATE "homework_assignments" ha
            SET "status" = 'DEACTIVATED', "updated_at" = now()
           FROM (SELECT "id", row_number() OVER (
                          PARTITION BY "homework_id", "${target}"
                          ORDER BY "created_at" DESC, "id" DESC) AS rn
                   FROM "homework_assignments"
                  WHERE "status" = 'ACTIVE' AND "${target}" IS NOT NULL) d
          WHERE ha."id" = d."id" AND d.rn > 1`,
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX "${SECTION_INDEX}" ON "homework_assignments" ("homework_id", "section_id") WHERE "status" = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "${STUDENT_INDEX}" ON "homework_assignments" ("homework_id", "student_id") WHERE "status" = 'ACTIVE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."${STUDENT_INDEX}"`);
    await queryRunner.query(`DROP INDEX "public"."${SECTION_INDEX}"`);
  }
}
