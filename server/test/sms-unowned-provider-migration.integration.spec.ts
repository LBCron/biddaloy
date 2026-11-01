import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { School } from '../src/modules/schools/entities/school.entity';
import { SmsDropUnownedGreenwebProvider1791900002000 } from '../src/migrations/1791900002000-SmsDropUnownedGreenwebProvider';

/**
 * [#3339] Schools on the platform SMS account that still store `provider: 'greenweb'` from the old
 * form, with nothing in the `greenweb` block, lose the stale company name (so `SMS_PROVIDER`
 * decides). Same rule as the runtime (`countedStoredProvider`): only the stored company's own
 * block counts, so a draft for another company does not keep the name (review round 1 on #3347).
 * A school with a Greenweb value of its own, or not PLATFORM-metered, keeps its row exactly.
 */
describe('SmsDropUnownedGreenwebProvider1791900002000 (integration)', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  const ids: string[] = [];
  const migration = new SmsDropUnownedGreenwebProvider1791900002000();

  beforeAll(async () => {
    const module = await createTestModule([School], []);
    dataSource = module.get(DataSource);
    queryRunner = dataSource.createQueryRunner();
  }, 60000);

  afterAll(async () => {
    if (ids.length > 0) await dataSource.query(`DELETE FROM "schools" WHERE id = ANY($1)`, [ids]);
    await queryRunner.release();
    await dataSource.destroy();
  });

  async function school(settings: object): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug, address, settings)
       VALUES (gen_random_uuid(), 'SMS Provider Migration', 'sms-prov-' || substr(gen_random_uuid()::text, 1, 8), 'Dhaka 1207', $1)
       RETURNING id`,
      [JSON.stringify(settings)],
    );
    ids.push(id);
    return id as string;
  }

  async function settingsOf(id: string) {
    const [row] = await dataSource.query(`SELECT settings FROM "schools" WHERE id = $1`, [id]);
    return row.settings as Record<string, unknown>;
  }

  it('drops the stale company only for PLATFORM schools that own nothing, and is idempotent', async () => {
    const region = { timezone: 'Asia/Dhaka' };
    const emptyBlock = {
      version: 1,
      region,
      communications: {
        sms: { metering: 'PLATFORM', provider: 'greenweb', greenweb: {} },
        email: { provider: 'smtp', smtp: { host: 'smtp.example' } },
      },
    };
    const clearedBlock = {
      version: 1,
      communications: {
        sms: { metering: 'PLATFORM', provider: 'greenweb', greenweb: { apiKey: null, apiUrl: '' } },
      },
    };
    const noBlock = {
      version: 1,
      communications: { sms: { metering: 'PLATFORM', provider: 'greenweb' } },
    };
    // Owns its own (encrypted) key: untouched.
    const ownKey = {
      version: 1,
      communications: {
        sms: { metering: 'PLATFORM', provider: 'greenweb', greenweb: { apiKey: 'enc:v1:abcd' } },
      },
    };
    // Owns its own address in the Greenweb block (next to another company's draft): untouched.
    const ownUrl = {
      version: 1,
      communications: {
        sms: {
          metering: 'PLATFORM',
          provider: 'greenweb',
          greenweb: { apiUrl: 'https://gw.example/api' },
          mimsms: { senderId: 'SCHOOL' },
        },
      },
    };
    // Old flat layout: the runtime never reads flat keys for SMS (it has several companies), so the
    // stale name goes and the flat key stays as it was.
    const flatOwn = {
      version: 1,
      communications: {
        sms: { metering: 'PLATFORM', provider: 'greenweb', apiUrl: 'https://gw.example/api' },
      },
    };
    // Not on the platform account: its company choice is its own.
    const ownMetering = {
      version: 1,
      communications: { sms: { provider: 'greenweb', greenweb: {} } },
    };
    const offMetering = {
      version: 1,
      communications: { sms: { metering: 'OFF', provider: 'greenweb', greenweb: {} } },
    };
    // A draft for another company does not own Greenweb: the name and the empty block go, the
    // draft stays.
    const otherDraft = {
      version: 1,
      communications: {
        sms: {
          metering: 'PLATFORM',
          provider: 'greenweb',
          greenweb: {},
          mimsms: { senderId: 'SCHOOL' },
        },
      },
    };
    // Another company name: not this migration's business.
    const otherCompany = {
      version: 1,
      communications: { sms: { metering: 'PLATFORM', provider: 'mimsms', mimsms: {} } },
    };

    const changed = {
      emptyBlock: await school(emptyBlock),
      clearedBlock: await school(clearedBlock),
      noBlock: await school(noBlock),
      flatOwn: await school(flatOwn),
      otherDraft: await school(otherDraft),
    };
    const untouched = {
      ownKey: [await school(ownKey), ownKey],
      ownUrl: [await school(ownUrl), ownUrl],
      ownMetering: [await school(ownMetering), ownMetering],
      offMetering: [await school(offMetering), offMetering],
      otherCompany: [await school(otherCompany), otherCompany],
    } as const;
    const nullSettings = await school({});
    await dataSource.query(`UPDATE "schools" SET settings = NULL WHERE id = $1`, [nullSettings]);

    await migration.up(queryRunner);
    // Idempotent: a second run changes nothing more.
    await migration.up(queryRunner);

    // Only provider and the empty greenweb block go; metering and every other section stay.
    expect(await settingsOf(changed.emptyBlock)).toEqual({
      version: 1,
      region,
      communications: {
        sms: { metering: 'PLATFORM' },
        email: { provider: 'smtp', smtp: { host: 'smtp.example' } },
      },
    });
    expect(await settingsOf(changed.clearedBlock)).toEqual({
      version: 1,
      communications: { sms: { metering: 'PLATFORM' } },
    });
    expect(await settingsOf(changed.noBlock)).toEqual({
      version: 1,
      communications: { sms: { metering: 'PLATFORM' } },
    });
    expect(await settingsOf(changed.flatOwn)).toEqual({
      version: 1,
      communications: { sms: { metering: 'PLATFORM', apiUrl: 'https://gw.example/api' } },
    });
    expect(await settingsOf(changed.otherDraft)).toEqual({
      version: 1,
      communications: { sms: { metering: 'PLATFORM', mimsms: { senderId: 'SCHOOL' } } },
    });

    for (const [id, before] of Object.values(untouched)) {
      expect(await settingsOf(id)).toEqual(before);
    }
    expect(await settingsOf(nullSettings)).toBeNull();

    // down() is a no-op and must not throw (it also runs on an empty database).
    await migration.down(queryRunner);
    expect(await settingsOf(changed.noBlock)).toEqual({
      version: 1,
      communications: { sms: { metering: 'PLATFORM' } },
    });
  });
});
