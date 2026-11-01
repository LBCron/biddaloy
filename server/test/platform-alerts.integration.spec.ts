import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID } from '@test/constants';
import { PlatformAlerts1791805000600 } from '../src/migrations/1791805000600-PlatformAlerts';
import { PlatformAlertsService } from '../src/modules/health/platform-alerts/platform-alerts.service';

/**
 * [75.34] The `platform_alerts` table and the SQL the probe loop relies on, against a real
 * database. Touches Postgres only: the probe is a fake and nothing connects to Redis.
 */
describe('platform_alerts (integration)', () => {
  let dataSource: DataSource;
  const userIds: string[] = [];
  let probe: 'ok' | 'fail';
  const greenweb = { send: vi.fn().mockResolvedValue({ success: true }) };
  let service: PlatformAlertsService;
  let platformTenantId: string | undefined = SEED_TENANT_ID;
  const env: Record<string, string | undefined> = { SMS_PROVIDER: 'p' };
  const otherTenantId = randomUUID();

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    service = new PlatformAlertsService(
      dataSource,
      { probeRedis: async () => probe } as never,
      { get: (k: string) => env[k] } as never,
      { resolve: async () => ({ provider: greenweb, config: {} }) } as never,
      { platformTenantId: async () => platformTenantId } as never,
    );
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other School', $2, NOW(), NOW())`,
      [otherTenantId, `pa-other-${otherTenantId.slice(0, 8)}`],
    );
  }, 60000);

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM platform_alerts`);
    greenweb.send.mockClear();
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM platform_alerts`);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [userIds]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [otherTenantId]);
    // audit_logs may reference users, so blank rather than delete.
    await dataSource.query(
      `UPDATE users SET phone = NULL, email = NULL, status = 'INACTIVE' WHERE id = ANY($1)`,
      [userIds],
    );
    await dataSource.destroy();
  });

  const openRows = async () =>
    dataSource.query(`SELECT * FROM platform_alerts WHERE cleared_at IS NULL`);
  const openInsert = () =>
    dataSource.query(
      `INSERT INTO platform_alerts (kind) VALUES ('REDIS_DOWN') ON CONFLICT (kind) WHERE cleared_at IS NULL DO NOTHING`,
    );

  it('migration down drops the table and up restores columns and the partial unique index', async () => {
    const migration = new PlatformAlerts1791805000600();
    const qr = dataSource.createQueryRunner();
    try {
      await migration.down(qr);
      const [gone] = await dataSource.query(`SELECT to_regclass('public.platform_alerts') AS t`);
      expect(gone.t).toBeNull();
    } finally {
      // Always leave the schema in its "up" state for later specs on this worker DB.
      const [there] = await dataSource.query(`SELECT to_regclass('public.platform_alerts') AS t`);
      if (there.t === null) await migration.up(qr);
      await qr.release();
    }
    const cols = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'platform_alerts'`,
    );
    expect(cols.map((c: { column_name: string }) => c.column_name).sort()).toEqual(
      [
        'cleared_at',
        'created_at',
        'id',
        'kind',
        'last_sms_at',
        'opened_at',
        'sms_count',
        'updated_at',
      ].sort(),
    );
    const idx = await dataSource.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_platform_alerts_open_kind'`,
    );
    expect(idx[0].indexdef).toContain('WHERE (cleared_at IS NULL)');
  });

  it('a second open INSERT for the same kind does nothing', async () => {
    await openInsert();
    await openInsert();
    expect(await openRows()).toHaveLength(1);
  });

  it('a cleared row does not block a new open row', async () => {
    await openInsert();
    await dataSource.query(`UPDATE platform_alerts SET cleared_at = now()`);
    await openInsert();
    expect(await openRows()).toHaveLength(1);
    expect(await dataSource.query(`SELECT 1 FROM platform_alerts`)).toHaveLength(2);
  });

  describe('hourly SMS gate', () => {
    const hourly = `UPDATE platform_alerts SET last_sms_at = now(), sms_count = sms_count + 1
       WHERE kind = 'REDIS_DOWN' AND cleared_at IS NULL
         AND (last_sms_at IS NULL OR last_sms_at <= now() - interval '1 hour') RETURNING opened_at`;

    it('returns the row at 61 minutes since the last text, not at 59', async () => {
      await openInsert();
      await dataSource.query(
        `UPDATE platform_alerts SET last_sms_at = now() - interval '59 minutes'`,
      );
      expect((await dataSource.query(hourly))[0]).toHaveLength(0);
      await dataSource.query(
        `UPDATE platform_alerts SET last_sms_at = now() - interval '61 minutes'`,
      );
      expect((await dataSource.query(hourly))[0]).toHaveLength(1);
    });
  });

  describe('recipients', () => {
    async function makeUser(
      suffix: string,
      o: { role: string; verified?: boolean; status?: string; deleted?: boolean; tenant?: string },
    ): Promise<string> {
      const phone = `0171${suffix}`;
      const [u] = await dataSource.query(
        `INSERT INTO users (email, phone, password_hash, full_name, status, phone_verified_at)
         VALUES ($1, $2, 'x', 'Alert Test', $3, $4) RETURNING id`,
        [
          `pa-${suffix}@test.local`,
          phone,
          o.status ?? 'ACTIVE',
          o.verified === false ? null : new Date(),
        ],
      );
      userIds.push(u.id);
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, deleted_at) VALUES ($1, $2, $3, $4)`,
        [u.id, o.tenant ?? SEED_TENANT_ID, o.role, o.deleted ? new Date() : null],
      );
      return phone;
    }

    it('returns verified active SUPER_ADMIN phones and skips everyone else', async () => {
      const good = await makeUser('9000001', { role: 'SUPER_ADMIN' });
      await makeUser('9000002', { role: 'SUPER_ADMIN', verified: false });
      await makeUser('9000003', { role: 'SUPER_ADMIN', status: 'SUSPENDED' });
      await makeUser('9000004', { role: 'SUPER_ADMIN', deleted: true });
      await makeUser('9000005', { role: 'ADMIN' });

      const phones = await service.recipients();
      expect(phones).toContain(good);
      for (const bad of ['9000002', '9000003', '9000004', '9000005']) {
        expect(phones).not.toContain(`0171${bad}`);
      }
    });

    // [75.34 review r1, F-2441-2] recipients never span tenants.
    it('texts only the platform tenant SUPER_ADMINs, and with no platform tenant only the env list', async () => {
      const platformSa = await makeUser('9000006', { role: 'SUPER_ADMIN' });
      const schoolSa = await makeUser('9000007', { role: 'SUPER_ADMIN', tenant: otherTenantId });
      env.PLATFORM_ALERT_PHONES = '01799999999';
      try {
        const scoped = await service.recipients();
        expect(scoped).toContain(platformSa);
        expect(scoped).not.toContain(schoolSa);

        platformTenantId = undefined;
        expect(await service.recipients()).toEqual(['01799999999']);
      } finally {
        platformTenantId = SEED_TENANT_ID;
        delete env.PLATFORM_ALERT_PHONES;
      }
    });
  });

  it('tick() opens one row after 3 failed probes, texts, and clears on the first good probe', async () => {
    probe = 'fail';
    for (let i = 0; i < 3; i++) await service.tick();
    expect(await openRows()).toHaveLength(1);
    expect((await openRows())[0].sms_count).toBe(1);
    const sentWhileOpen = greenweb.send.mock.calls.length;

    // Still failing within the hour: no second text, still one row.
    await service.tick();
    expect(await openRows()).toHaveLength(1);
    expect(greenweb.send.mock.calls.length).toBe(sentWhileOpen);

    probe = 'ok';
    await service.tick();
    expect(await openRows()).toHaveLength(0);
    expect((await service.listOpen()).alerts).toEqual([]);
  });

  it('listOpen returns the open row', async () => {
    await openInsert();
    const { alerts } = await service.listOpen();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('REDIS_DOWN');
  });
});
