import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [40.6.02] Photo gallery: `site_gallery_albums` and `site_gallery_photos`. A photo's album and
 * picture FKs are composite `(tenant_id, x) -> parent(tenant_id, id)` (same shape as the picture
 * FKs of `1791900003400-SchoolWebsite`), so a photo can never point at another school's album or
 * picture. Both are ON DELETE RESTRICT; the school FK is CASCADE.
 */
export class SiteGallery1791900003600 implements MigrationInterface {
  name = 'SiteGallery1791900003600';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "site_gallery_albums" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "title" jsonb NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_site_gallery_albums" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_site_gallery_albums_tenant_id" UNIQUE ("tenant_id", "id"),
        CONSTRAINT "FK_site_gallery_albums_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_site_gallery_albums_tenant_sort" ON "site_gallery_albums" ("tenant_id", "sort_order")`,
    );
    await queryRunner.query(`
      CREATE TABLE "site_gallery_photos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "album_id" uuid NOT NULL,
        "media_id" uuid NOT NULL,
        "caption" jsonb,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_site_gallery_photos" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_site_gallery_photos_album_media" UNIQUE ("album_id", "media_id"),
        CONSTRAINT "FK_site_gallery_photos_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_site_gallery_photos_album_id" FOREIGN KEY ("tenant_id", "album_id") REFERENCES "site_gallery_albums"("tenant_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "FK_site_gallery_photos_media_id" FOREIGN KEY ("tenant_id", "media_id") REFERENCES "site_media"("tenant_id", "id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_site_gallery_photos_album_sort" ON "site_gallery_photos" ("album_id", "sort_order")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_site_gallery_photos_media" ON "site_gallery_photos" ("tenant_id", "media_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "site_gallery_photos"`);
    await queryRunner.query(`DROP TABLE "site_gallery_albums"`);
  }
}
