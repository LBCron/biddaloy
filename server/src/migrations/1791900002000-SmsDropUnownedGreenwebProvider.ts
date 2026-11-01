import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [#3339] The old SMS form stored `communications.sms.provider = 'greenweb'` for schools on the
 * platform account. That stored name beats the platform's `SMS_PROVIDER`, so once production
 * picks another company those schools would stop sending.
 *
 * Removes `provider` and the `greenweb` block from `communications.sms` only when:
 *   - `metering` is `PLATFORM`, and `provider` is `greenweb`, and
 *   - the `greenweb` block (if any) holds no non-empty value (an encrypted `apiKey` or an `apiUrl`
 *     is the school's own and keeps the row exactly).
 * This is the SQL twin of the runtime rule `countedStoredProvider` (messaging-descriptors.ts):
 * only the stored company's own block counts, so a draft for another company or an old flat key
 * (never read for SMS) does not keep the stale name (review round 1 on #3347). Every Greenweb
 * field is owned, so "no value at all" in that block is the same test. `metering`, other
 * companies' blocks and every other setting stay. Idempotent: a cleaned row no longer matches.
 *
 *   before: { metering: 'PLATFORM', provider: 'greenweb', greenweb: {}, mimsms: { senderId: 'X' } }
 *   after:  { metering: 'PLATFORM', mimsms: { senderId: 'X' } }
 *
 * Operator note: the runtime already ignores the stale name, so the change is cleanup and no send
 * changes because of it. `TenantSettingsCache` is in-memory per process with a 30 s TTL; a process
 * that read a row before the migration may serve the old copy for up to 30 s, which resolves to
 * the same company. Nothing to flush.
 */
export class SmsDropUnownedGreenwebProvider1791900002000 implements MigrationInterface {
  name = 'SmsDropUnownedGreenwebProvider1791900002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "schools" s
      SET "settings" = jsonb_set(
        s."settings",
        '{communications,sms}',
        (s."settings" #> '{communications,sms}') - 'provider' - 'greenweb'
      )
      WHERE s."settings" #>> '{communications,sms,metering}' = 'PLATFORM'
        AND s."settings" #>> '{communications,sms,provider}' = 'greenweb'
        AND jsonb_typeof(s."settings" #> '{communications,sms}') = 'object'
        AND NOT COALESCE(
          jsonb_path_exists(
            s."settings" #> '{communications,sms,greenweb}',
            '$.** ? (@.type() == "number" || @.type() == "boolean" || (@.type() == "string" && @ != ""))'
          ),
          false
        )
    `);
  }

  /** Nothing to restore: the removed name and block held no value of the school's own. */
  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
