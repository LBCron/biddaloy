import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [53.1.02] Notice board schema: `notices`, `notice_attachments`,
 * `notice_recipients`. Every table carries `tenant_id` (NOT NULL, FK schools
 * CASCADE). Child FKs to `notices` are RESTRICT (D27): a notice with
 * recipients/attachments cannot be hard-deleted. Enums are varchar + CHECK
 * (repo style, see alert_recipients); values mirror `@biddaloy/shared`.
 * Only SHA-256 hashes of public/link tokens are stored.
 */
export class Notices1791900002100 implements MigrationInterface {
  name = 'Notices1791900002100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "author_user_id" uuid NOT NULL,
        "title" varchar(140) NOT NULL,
        "body" text NOT NULL,
        "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
        "important" boolean NOT NULL DEFAULT false,
        "pinned" boolean NOT NULL DEFAULT false,
        "is_public" boolean NOT NULL DEFAULT false,
        "expires_on" date,
        "published_at" timestamptz,
        "edited_at" timestamptz,
        "withdrawn_at" timestamptz,
        "withdrawn_by_user_id" uuid,
        "public_token_hash" varchar(64),
        "public_token_created_at" timestamptz,
        "sms_status" varchar(10) NOT NULL DEFAULT 'NONE',
        "sms_requested_by_user_id" uuid,
        "sms_requested_at" timestamptz,
        "sms_decided_by_user_id" uuid,
        "sms_decided_at" timestamptz,
        "alert_id" uuid,
        "sms_task_alert_id" uuid,
        "recipient_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_notices_public_token_hash" UNIQUE ("public_token_hash"),
        CONSTRAINT "CHK_notices_body_len" CHECK (char_length("body") <= 5000),
        CONSTRAINT "CHK_notices_status" CHECK ("status" IN ('DRAFT','PUBLISHED','WITHDRAWN')),
        CONSTRAINT "CHK_notices_sms_status" CHECK ("sms_status" IN ('NONE','PENDING','APPROVED','DECLINED')),
        CONSTRAINT "CHK_notices_published_at" CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL),
        CONSTRAINT "CHK_notices_withdrawn_at" CHECK ("status" <> 'WITHDRAWN' OR "withdrawn_at" IS NOT NULL)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notices_tenant_status_published" ON "notices" ("tenant_id", "status", "published_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notices_tenant_author" ON "notices" ("tenant_id", "author_user_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notices" ADD CONSTRAINT "FK_notices_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notices" ADD CONSTRAINT "FK_notices_author_user_id" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "notice_attachments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "notice_id" uuid NOT NULL,
        "storage_key" varchar(500) NOT NULL,
        "mime_type" varchar(50) NOT NULL,
        "size_bytes" integer NOT NULL,
        "original_name" varchar(255) NOT NULL,
        "sort" smallint NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notice_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_notice_attachments_mime" CHECK ("mime_type" IN ('application/pdf','image/png','image/jpeg','image/webp')),
        CONSTRAINT "CHK_notice_attachments_size" CHECK ("size_bytes" BETWEEN 1 AND 5242880)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notice_attachments_notice_id" ON "notice_attachments" ("notice_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notice_attachments_tenant_id" ON "notice_attachments" ("tenant_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notice_attachments" ADD CONSTRAINT "FK_notice_attachments_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notice_attachments" ADD CONSTRAINT "FK_notice_attachments_notice_id" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "notice_recipients" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "notice_id" uuid NOT NULL,
        "kind" varchar(10) NOT NULL,
        "user_id" uuid,
        "student_id" uuid,
        "guardian_id" uuid,
        "seen_at" timestamptz,
        "acknowledged_at" timestamptz,
        "link_token_hash" varchar(64),
        "link_opened_at" timestamptz,
        "sms_wanted" boolean NOT NULL DEFAULT true,
        "sms_sent_at" timestamptz,
        "communication_log_id" uuid,
        "pushed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notice_recipients" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_notice_recipients_link_token_hash" UNIQUE ("link_token_hash"),
        CONSTRAINT "CHK_notice_recipients_kind" CHECK ("kind" IN ('STAFF','STUDENT','GUARDIAN')),
        CONSTRAINT "CHK_notice_recipients_target" CHECK (
          ("kind" = 'STAFF' AND "user_id" IS NOT NULL)
          OR ("kind" = 'STUDENT' AND "student_id" IS NOT NULL)
          OR ("kind" = 'GUARDIAN' AND "guardian_id" IS NOT NULL AND "student_id" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_notice_recipients_staff" ON "notice_recipients" ("notice_id", "user_id") WHERE "kind" = 'STAFF'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_notice_recipients_student" ON "notice_recipients" ("notice_id", "student_id") WHERE "kind" = 'STUDENT'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_notice_recipients_guardian" ON "notice_recipients" ("notice_id", "guardian_id", "student_id") WHERE "kind" = 'GUARDIAN'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notice_recipients_tenant_user" ON "notice_recipients" ("tenant_id", "user_id")`,
    );
    // the reader claims rows by student / guardian (a login made after publish)
    await queryRunner.query(
      `CREATE INDEX "IDX_notice_recipients_tenant_student" ON "notice_recipients" ("tenant_id", "student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notice_recipients_tenant_guardian" ON "notice_recipients" ("tenant_id", "guardian_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notice_recipients" ADD CONSTRAINT "FK_notice_recipients_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notice_recipients" ADD CONSTRAINT "FK_notice_recipients_notice_id" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notice_recipients" ADD CONSTRAINT "FK_notice_recipients_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notice_recipients" ADD CONSTRAINT "FK_notice_recipients_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notice_recipients" ADD CONSTRAINT "FK_notice_recipients_guardian_id" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notice_recipients" ADD CONSTRAINT "FK_notice_recipients_communication_log_id" FOREIGN KEY ("communication_log_id") REFERENCES "communication_logs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notice_recipients"`);
    await queryRunner.query(`DROP TABLE "notice_attachments"`);
    await queryRunner.query(`DROP TABLE "notices"`);
  }
}
