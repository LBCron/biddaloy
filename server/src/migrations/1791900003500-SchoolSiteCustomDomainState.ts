import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [40.4.08] Custom-domain state the status poll needs: the DNS records to show the admin, when the
 * status last changed (7 days without progress -> FAILED) and when Cloudflare was last asked.
 * All nullable: a school with no custom domain carries NULL in all three.
 */
export class SchoolSiteCustomDomainState1791900003500 implements MigrationInterface {
  name = 'SchoolSiteCustomDomainState1791900003500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "school_sites"
        ADD COLUMN "custom_domain_records" jsonb,
        ADD COLUMN "custom_domain_since" timestamptz,
        ADD COLUMN "custom_domain_checked_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "school_sites"
        DROP COLUMN "custom_domain_checked_at",
        DROP COLUMN "custom_domain_since",
        DROP COLUMN "custom_domain_records"
    `);
  }
}
