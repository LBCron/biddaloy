import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [40.1.03] Epic 40 public school website: five new tables, website columns on `exams` and
 * `notices`, and the unused `schools.domain` column is dropped (`down()` re-adds it, nullable,
 * with its unique partial index). `down()` works on an empty database.
 *
 * Picture FKs are composite `(tenant_id, media_id) -> site_media(tenant_id, id)` (same shape as
 * `1791600000000-Applications`), so a post or staff card can never point at another school's
 * picture. `ON DELETE SET NULL (col)` (Postgres 15+) clears only the media column, never
 * `tenant_id`. `previous_subdomain` gets no extra index: its UNIQUE constraint already is one.
 */
export class SchoolWebsite1791900003400 implements MigrationInterface {
  name = 'SchoolWebsite1791900003400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "school_sites" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "subdomain" varchar(30) NOT NULL,
        "previous_subdomain" varchar(30),
        "previous_until" timestamptz,
        "custom_domain" varchar(253),
        "custom_domain_status" varchar(20),
        "custom_domain_external_id" varchar(64),
        "theme" varchar(20) NOT NULL DEFAULT 'basic',
        "palette" varchar(40) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "noindex" boolean NOT NULL DEFAULT false,
        "draft" jsonb NOT NULL,
        "published" jsonb,
        "version" integer NOT NULL DEFAULT 0,
        "draft_revision" integer NOT NULL DEFAULT 0,
        "published_at" timestamptz,
        "umami_website_id" varchar(64),
        "media_bytes_used" bigint NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_school_sites" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_school_sites_tenant_id" UNIQUE ("tenant_id"),
        CONSTRAINT "UQ_school_sites_subdomain" UNIQUE ("subdomain"),
        CONSTRAINT "UQ_school_sites_previous_subdomain" UNIQUE ("previous_subdomain"),
        CONSTRAINT "UQ_school_sites_custom_domain" UNIQUE ("custom_domain"),
        CONSTRAINT "CHK_school_sites_subdomain" CHECK ("subdomain" ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
        CONSTRAINT "CHK_school_sites_media_bytes_used" CHECK ("media_bytes_used" >= 0),
        CONSTRAINT "CHK_school_sites_custom_domain_lower" CHECK ("custom_domain" = lower("custom_domain")),
        CONSTRAINT "FK_school_sites_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )`);

    await queryRunner.query(`
      CREATE TABLE "site_media" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "slot" varchar(20) NOT NULL,
        "storage_key" varchar(255) NOT NULL,
        "hash" char(64) NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "bytes" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_site_media" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_site_media_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "UQ_site_media_tenant_hash" UNIQUE ("tenant_id", "hash"),
        CONSTRAINT "UQ_site_media_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "CHK_site_media_bytes" CHECK ("bytes" > 0),
        CONSTRAINT "FK_site_media_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )`);

    await queryRunner.query(`
      CREATE TABLE "site_posts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "kind" varchar(4) NOT NULL DEFAULT 'POST',
        "slug" varchar(80) NOT NULL,
        "title" jsonb NOT NULL,
        "cover_media_id" uuid,
        "body" jsonb NOT NULL,
        "published_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_site_posts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_site_posts_tenant_slug" UNIQUE ("tenant_id", "slug"),
        CONSTRAINT "CHK_site_posts_kind" CHECK ("kind" IN ('POST','PAGE')),
        CONSTRAINT "FK_site_posts_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_site_posts_cover_media_id" FOREIGN KEY ("tenant_id", "cover_media_id") REFERENCES "site_media"("tenant_id", "id") ON DELETE SET NULL ("cover_media_id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_site_posts_tenant_published" ON "site_posts" ("tenant_id", "published_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "site_enquiries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "phone" varchar(20) NOT NULL,
        "message" text NOT NULL,
        "seen_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_site_enquiries" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_site_enquiries_message_len" CHECK (char_length("message") <= 2000),
        CONSTRAINT "FK_site_enquiries_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_site_enquiries_tenant_created" ON "site_enquiries" ("tenant_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "staff_web_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "show_on_website" boolean NOT NULL DEFAULT false,
        "featured" boolean NOT NULL DEFAULT false,
        "sort_order" integer NOT NULL DEFAULT 0,
        "subjects" text array NOT NULL DEFAULT '{}',
        "bio" jsonb,
        "credentials" jsonb,
        "photo_media_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_web_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_web_profiles_tenant_user" UNIQUE ("tenant_id", "user_id"),
        CONSTRAINT "FK_staff_web_profiles_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_web_profiles_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_web_profiles_photo_media_id" FOREIGN KEY ("tenant_id", "photo_media_id") REFERENCES "site_media"("tenant_id", "id") ON DELETE SET NULL ("photo_media_id")
      )`);

    await queryRunner.query(`ALTER TABLE "exams" ADD "website_published_at" timestamptz`);
    await queryRunner.query(
      `ALTER TABLE "exams" ADD "website_show_names" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "notices" ADD "pinned_on_website" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`DROP INDEX "public"."IDX_schools_domain"`);
    await queryRunner.query(`ALTER TABLE "schools" DROP COLUMN "domain"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "schools" ADD "domain" varchar(255)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_schools_domain" ON "schools" ("domain") WHERE domain IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "notices" DROP COLUMN "pinned_on_website"`);
    await queryRunner.query(`ALTER TABLE "exams" DROP COLUMN "website_show_names"`);
    await queryRunner.query(`ALTER TABLE "exams" DROP COLUMN "website_published_at"`);
    await queryRunner.query(`DROP TABLE "staff_web_profiles"`);
    await queryRunner.query(`DROP TABLE "site_enquiries"`);
    await queryRunner.query(`DROP TABLE "site_posts"`);
    await queryRunner.query(`DROP TABLE "site_media"`);
    await queryRunner.query(`DROP TABLE "school_sites"`);
  }
}
