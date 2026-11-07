import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic 40: `school_sites.draft_revision`: bumped on every draft save so a stale save or a
 * publish of an unseen draft is a 409. Its own migration, not an edit to 1791900003400: that
 * file already ran on environments that took the previous merge, and a migration that has run
 * is never edited. IF NOT EXISTS keeps a database that got the column from the edited
 * 1791900003400 working.
 */
export class SchoolSiteDraftRevision1791900003450 implements MigrationInterface {
  name = 'SchoolSiteDraftRevision1791900003450';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "school_sites" ADD COLUMN IF NOT EXISTS "draft_revision" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "school_sites" DROP COLUMN IF EXISTS "draft_revision"`);
  }
}
