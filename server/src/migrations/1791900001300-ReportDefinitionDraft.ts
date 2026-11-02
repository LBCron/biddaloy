import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [8.15.23] The editable draft of a report lives on the definition row (like `print_templates.draft`).
 * The ticket put it in a version row with no `published_at`, but a version is immutable (trigger) and
 * `published_at` is required, so it cannot be edited there. Null until the first draft is saved.
 */
export class ReportDefinitionDraft1791900001300 implements MigrationInterface {
  name = 'ReportDefinitionDraft1791900001300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "report_definitions" ADD "draft" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "report_definitions" DROP COLUMN "draft"`);
  }
}
