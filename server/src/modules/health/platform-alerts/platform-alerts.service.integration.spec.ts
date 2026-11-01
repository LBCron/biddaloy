import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { PlatformAlertsService } from './platform-alerts.service';

/**
 * D25: two prod app containers both run the probe. Every state change is one conditional SQL
 * statement, so during a Redis outage there is one row and one SMS per hour, not two.
 * Serial by nature: `platform_alerts` is a global table.
 */
describe('PlatformAlertsService (two instances, real DB)', () => {
  let module: TestingModule;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM platform_alerts`);
    await module.close();
  });

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await dataSource.query(`DELETE FROM platform_alerts`);
  });

  /** Both instances share the DB and one gateway spy; `gate` holds the probes together. */
  function twoInstances() {
    let release!: () => void;
    let gate = new Promise<void>((r) => (release = r));
    let result: 'ok' | 'fail' = 'fail';
    const send = vi.fn().mockResolvedValue({ success: true });
    const make = () =>
      new PlatformAlertsService(
        dataSource,
        {
          probeRedis: async () => {
            await gate;
            return result;
          },
        } as never,
        {
          get: (k: string) => ({ SMS_PROVIDER: 'p', PLATFORM_ALERT_PHONES: '01700000000' })[k],
        } as never,
        { resolve: async () => ({ provider: { send }, config: {} }) } as never,
        { platformTenantId: async () => undefined } as never,
      );
    const a = make();
    const b = make();
    /** Hold both probes, start both ticks, then let them run into the DB at the same moment. */
    const round = async (r: 'ok' | 'fail') => {
      result = r;
      gate = new Promise<void>((res) => (release = res));
      const ticks = Promise.all([a.tick(), b.tick()]);
      release();
      await ticks;
    };
    return { round, send };
  }

  const openRows = () =>
    dataSource.query(`SELECT sms_count FROM platform_alerts WHERE cleared_at IS NULL`);

  it('a Redis outage on both instances opens one row and sends one SMS', async () => {
    const { round, send } = twoInstances();
    await round('fail');
    await round('fail');
    expect(await openRows()).toHaveLength(0); // 2 fails each: not yet open
    await round('fail'); // 3rd fail on both, at the same moment
    const rows = await openRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].sms_count).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    // Still down inside the hour: neither instance texts again.
    await round('fail');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('recovery on both instances closes the row and sends one "recovered" SMS', async () => {
    const { round, send } = twoInstances();
    await round('fail');
    await round('fail');
    await round('fail');
    expect(send).toHaveBeenCalledTimes(1); // the "down" text
    await round('ok');
    expect(await openRows()).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(2); // + one "recovered", not two
    expect(send.mock.calls[1][0].body).toContain('RECOVERED');
  });
});
