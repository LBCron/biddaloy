import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { CommunicationLog } from './entities/communication-log.entity';
import { BulkReminderService } from './reminders.service';

/**
 * [97.4.01] `findLogs` (GET /communications/logs) against the real schema: every D22 filter alone
 * and combined, D33 phone search, the school-day date bound, PUSH exclusion and tenant isolation.
 */
describe('BulkReminderService.findLogs (integration)', () => {
  let dataSource: DataSource;
  let service: BulkReminderService;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(getDataSourceToken());
    // findLogs only reads the log repository; the send-side collaborators are never touched.
    const unused = {} as any;
    service = new BulkReminderService(
      module.get(getRepositoryToken(CommunicationLog)),
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function makeSchool(name: string): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO "schools" (id, name, slug) VALUES (gen_random_uuid(), $1, 'logs-int-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
      [name],
    );
    return id;
  }

  async function addLog(
    tenantId: string,
    row: {
      name?: string;
      address?: string;
      medium?: string;
      status?: string;
      trigger?: string;
      sentBy?: string | null;
      provider?: string;
      createdAt?: string;
    } = {},
  ): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO communication_logs
         (tenant_id, medium, recipient_address, recipient_name, message_body, status, trigger, sent_by_user_id, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'hi', $5, $6, $7, $8, $9, $9) RETURNING id`,
      [
        tenantId,
        row.medium ?? CommunicationMedium.SMS,
        row.address ?? '01700000000',
        row.name ?? 'Someone',
        row.status ?? CommunicationStatus.SENT,
        row.trigger ?? CommunicationTrigger.MANUAL,
        row.sentBy ?? null,
        row.provider ? JSON.stringify({ provider: row.provider }) : null,
        row.createdAt ?? '2026-10-07T04:00:00Z',
      ],
    );
    return id;
  }

  const ids = (res: { data: { id: string }[] }) => res.data.map((r) => r.id).sort();

  beforeEach(async () => {
    tenantA = await makeSchool('Logs Int A');
    tenantB = await makeSchool('Logs Int B');
  });

  afterEach(async () => {
    await dataSource.query(`DELETE FROM communication_logs WHERE tenant_id IN ($1, $2)`, [
      tenantA,
      tenantB,
    ]);
    await dataSource.query(`DELETE FROM "schools" WHERE id IN ($1, $2)`, [tenantA, tenantB]);
  });

  it('never returns another tenant’s rows, even when every filter matches them', async () => {
    const own = await addLog(tenantA, { name: 'Karim', provider: 'stub-sms' });
    await addLog(tenantB, { name: 'Karim', provider: 'stub-sms' });

    const res = await service.findLogs({ search: 'Karim', provider: 'stub-sms' }, tenantA, 'ADMIN');

    expect(ids(res)).toEqual([own]);
  });

  it('pages newest first and leaves PUSH rows out', async () => {
    const older = await addLog(tenantA, { createdAt: '2026-10-01T04:00:00Z' });
    const newer = await addLog(tenantA, { createdAt: '2026-10-02T04:00:00Z' });
    await addLog(tenantA, { medium: 'PUSH', address: 'push:user' });

    const page1 = await service.findLogs({ page: 1, limit: 1 }, tenantA, 'ADMIN');
    const page2 = await service.findLogs({ page: 2, limit: 1 }, tenantA, 'ADMIN');

    expect(page1).toMatchObject({ total: 2, totalPages: 2, data: [{ id: newer }] });
    expect(page2.data.map((r) => r.id)).toEqual([older]);
  });

  describe('each filter alone', () => {
    it('status', async () => {
      const failed = await addLog(tenantA, { status: CommunicationStatus.FAILED });
      await addLog(tenantA, { status: CommunicationStatus.SENT });
      expect(
        ids(await service.findLogs({ status: CommunicationStatus.FAILED }, tenantA, 'ADMIN')),
      ).toEqual([failed]);
    });

    it('medium', async () => {
      const email = await addLog(tenantA, {
        medium: CommunicationMedium.EMAIL,
        address: 'a@b.test',
      });
      await addLog(tenantA, { medium: CommunicationMedium.SMS });
      expect(
        ids(await service.findLogs({ medium: CommunicationMedium.EMAIL }, tenantA, 'ADMIN')),
      ).toEqual([email]);
    });

    it('trigger', async () => {
      const auto = await addLog(tenantA, { trigger: CommunicationTrigger.AUTOMATED });
      await addLog(tenantA, { trigger: CommunicationTrigger.MANUAL });
      expect(
        ids(await service.findLogs({ trigger: CommunicationTrigger.AUTOMATED }, tenantA, 'ADMIN')),
      ).toEqual([auto]);
    });

    it('sent_by', async () => {
      const mine = await addLog(tenantA, { sentBy: SEED_ADMIN_USER_ID });
      await addLog(tenantA, { sentBy: null });
      expect(
        ids(await service.findLogs({ sent_by: SEED_ADMIN_USER_ID }, tenantA, 'ADMIN')),
      ).toEqual([mine]);
    });

    it('provider (metadata.provider)', async () => {
      const a = await addLog(tenantA, { provider: 'stub-a' });
      await addLog(tenantA, { provider: 'stub-b' });
      await addLog(tenantA, {});
      expect(ids(await service.findLogs({ provider: 'stub-a' }, tenantA, 'ADMIN'))).toEqual([a]);
    });

    it('date from/to are school (Asia/Dhaka) days, not UTC days', async () => {
      // 2026-10-06T19:00Z is 01:00 on 7 Oct in Dhaka; 2026-10-07T17:59Z is 23:59 on 7 Oct.
      const startOfDay = await addLog(tenantA, { createdAt: '2026-10-06T19:00:00Z' });
      const endOfDay = await addLog(tenantA, { createdAt: '2026-10-07T17:59:00Z' });
      await addLog(tenantA, { createdAt: '2026-10-06T17:00:00Z' }); // 23:00 on 6 Oct, Dhaka
      await addLog(tenantA, { createdAt: '2026-10-07T18:30:00Z' }); // 00:30 on 8 Oct, Dhaka

      const res = await service.findLogs(
        { from_date: '2026-10-07', to_date: '2026-10-07' },
        tenantA,
        'ADMIN',
      );

      expect(ids(res)).toEqual([startOfDay, endOfDay].sort());
    });

    it('search by recipient name, case-insensitive, with LIKE wildcards treated literally', async () => {
      const karim = await addLog(tenantA, { name: 'Karim Uddin' });
      await addLog(tenantA, { name: 'Rahim' });
      expect(ids(await service.findLogs({ search: 'karim' }, tenantA, 'ADMIN'))).toEqual([karim]);
      // `%` would match everything if it were not escaped (normalizeSearchTerm).
      expect((await service.findLogs({ search: '%' }, tenantA, 'ADMIN')).total).toBe(0);
    });

    it('search by email address', async () => {
      const mail = await addLog(tenantA, {
        medium: CommunicationMedium.EMAIL,
        address: 'guardian@school.test',
      });
      await addLog(tenantA, {});
      expect(ids(await service.findLogs({ search: 'guardian@school' }, tenantA, 'ADMIN'))).toEqual([
        mail,
      ]);
    });
  });

  describe('phone search (D33)', () => {
    let target: string;

    beforeEach(async () => {
      target = await addLog(tenantA, { address: '01712345678' });
      await addLog(tenantA, { address: '01811111111' });
    });

    it('finds the stored 01… number from a +880 form with spaces and a dash', async () => {
      expect(ids(await service.findLogs({ search: '+880 1712-345678' }, tenantA, 'ADMIN'))).toEqual(
        [target],
      );
    });

    it('finds it from the 8801… form', async () => {
      expect(ids(await service.findLogs({ search: '8801712345678' }, tenantA, 'ADMIN'))).toEqual([
        target,
      ]);
    });

    it('finds it from the 01… form with spaces', async () => {
      expect(ids(await service.findLogs({ search: '01712 345678' }, tenantA, 'ADMIN'))).toEqual([
        target,
      ]);
    });

    it('finds it from Bengali digits', async () => {
      expect(ids(await service.findLogs({ search: '০১৭১২৩৪৫৬৭৮' }, tenantA, 'ADMIN'))).toEqual([
        target,
      ]);
    });

    // Review round 1 on #3347: `880` alone would become `0` and match nearly every number.
    it('a phone term under 4 digits after the country code is not a phone search', async () => {
      expect(ids(await service.findLogs({ search: '880' }, tenantA, 'ADMIN'))).toEqual([]);
      expect(ids(await service.findLogs({ search: '+880 1' }, tenantA, 'ADMIN'))).toEqual([]);
    });

    // Review round 2 on #3347: only the real country code `880` is dropped. `8812345678` is not a
    // `+880` number, so it must not turn into `12345678` (which is inside 01712345678).
    it('drops only the 880 country code, not any leading 88', async () => {
      expect(ids(await service.findLogs({ search: '8812345678' }, tenantA, 'ADMIN'))).toEqual([]);
    });

    // Review round 2 on #3347: a writer may store the number formatted.
    it('finds a number stored with spaces and a dash from the 01… form', async () => {
      const formatted = await addLog(tenantA, { address: '+880 1712-345678' });
      for (const search of ['01712345678', '+880 1712 345678']) {
        const found = ids(await service.findLogs({ search }, tenantA));
        expect(found.sort()).toEqual([formatted, target].sort());
      }
    });

    it('finds a +880-stored number from the 01… form', async () => {
      const plus = await addLog(tenantA, { address: '+8801999888777' });
      expect(ids(await service.findLogs({ search: '01999888777' }, tenantA, 'ADMIN'))).toEqual([
        plus,
      ]);
    });
  });

  it('combines filters with AND', async () => {
    const hit = await addLog(tenantA, {
      name: 'Karim',
      status: CommunicationStatus.SENT,
      trigger: CommunicationTrigger.MANUAL,
      sentBy: SEED_ADMIN_USER_ID,
      provider: 'stub-a',
    });
    await addLog(tenantA, { name: 'Karim', provider: 'stub-b', sentBy: SEED_ADMIN_USER_ID });
    await addLog(tenantA, {
      name: 'Karim',
      provider: 'stub-a',
      status: CommunicationStatus.FAILED,
    });
    await addLog(tenantA, { name: 'Rahim', provider: 'stub-a', sentBy: SEED_ADMIN_USER_ID });

    const res = await service.findLogs(
      {
        search: 'Karim',
        status: CommunicationStatus.SENT,
        medium: CommunicationMedium.SMS,
        trigger: CommunicationTrigger.MANUAL,
        sent_by: SEED_ADMIN_USER_ID,
        provider: 'stub-a',
      },
      tenantA,
      'ADMIN',
    );

    expect(ids(res)).toEqual([hit]);
    expect(res.data[0]).toMatchObject({ trigger: 'MANUAL', provider: 'stub-a' });
  });
});
