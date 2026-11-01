import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [53.2.03] Notice alerts write `source = 'NOTICE'` and `category = 'NOTICE'`
 * (mirrors `AlertSource` / `AlertCategory` in `@biddaloy/shared`), so both CHECK
 * constraints on `alerts` gain that value. `down()` deletes NOTICE alert rows
 * (their recipients cascade) and clears the two plain alert-id columns on
 * `notices`, so the old, narrower constraints can be restored on any data.
 */
export class NoticeAlertChecks1791900001300 implements MigrationInterface {
  name = 'NoticeAlertChecks1791900001300';

  private static readonly CATEGORIES =
    "'SETUP','SYSTEM','STRUCTURE','ATTENDANCE','PERIOD','HOMEWORK','CLASS','STUDY_PLAN','FEES','EXAMS','OFFICE','FAMILY','COMMON','PLATFORM','BILLING','MANUAL'";

  private async setChecks(q: QueryRunner, sources: string, categories: string) {
    await q.query(`ALTER TABLE "alerts" DROP CONSTRAINT "CHK_alerts_source"`);
    await q.query(`ALTER TABLE "alerts" DROP CONSTRAINT "CHK_alerts_category"`);
    await q.query(
      `ALTER TABLE "alerts" ADD CONSTRAINT "CHK_alerts_source" CHECK ("source" IN (${sources}))`,
    );
    await q.query(
      `ALTER TABLE "alerts" ADD CONSTRAINT "CHK_alerts_category" CHECK ("category" IN (${categories}))`,
    );
  }

  public async up(q: QueryRunner): Promise<void> {
    await this.setChecks(
      q,
      "'RULE','MANUAL','NOTICE'",
      `${NoticeAlertChecks1791900001300.CATEGORIES},'NOTICE'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "notices" SET "alert_id" = NULL, "sms_task_alert_id" = NULL WHERE "alert_id" IS NOT NULL OR "sms_task_alert_id" IS NOT NULL`,
    );
    await q.query(`DELETE FROM "alerts" WHERE "source" = 'NOTICE' OR "category" = 'NOTICE'`);
    await this.setChecks(q, "'RULE','MANUAL'", NoticeAlertChecks1791900001300.CATEGORIES);
  }
}
