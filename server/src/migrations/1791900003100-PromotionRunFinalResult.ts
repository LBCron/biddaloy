import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [70.3.3] `promotion_runs.final_result_id`: a run may take a PUBLISHED final result as its
 * merit source instead of `exam_ids` (then `exam_ids` is `[]`; the CHECK keeps the two apart).
 * The FK is NO ACTION (a final that a run uses cannot be hard-deleted); its name is TypeORM's
 * own so the entity shows no drift. `down()` works on an empty database.
 */
export class PromotionRunFinalResult1791900003100 implements MigrationInterface {
  name = 'PromotionRunFinalResult1791900003100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "promotion_runs" ADD "final_result_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "promotion_runs" ADD CONSTRAINT "CHK_promotion_runs_one_merit_source" CHECK ("final_result_id" IS NULL OR cardinality("exam_ids") = 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "promotion_runs" ADD CONSTRAINT "FK_2bbb6b2e08da13192148c9c5104" FOREIGN KEY ("final_result_id") REFERENCES "final_results"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "promotion_runs" DROP CONSTRAINT "FK_2bbb6b2e08da13192148c9c5104"`,
    );
    await queryRunner.query(
      `ALTER TABLE "promotion_runs" DROP CONSTRAINT "CHK_promotion_runs_one_merit_source"`,
    );
    await queryRunner.query(`ALTER TABLE "promotion_runs" DROP COLUMN "final_result_id"`);
  }
}
