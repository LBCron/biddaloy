import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID as TENANT_ID } from '@test/constants';
import {
  balanceFor,
  ledgerFor,
  makeMeteredCreditService,
  makeProcessor,
  runJob,
} from '@test/helpers/sms-credit-ledger.helper';
import { CommunicationStatus, countSmsSegments } from '@biddaloy/shared';
import { CommunicationLog } from '../../communications/entities/communication-log.entity';
import { SmsCreditService } from '../../communications/credits/sms-credit.service';
import { ATTENTION_RULE_LOCK_NAMESPACE } from '../engine/alert-writer.service';
import { GuardianSmsFallbackService } from './guardian-sms-fallback.service';

/**
 * [67.5.02] Guardian SMS fallback against the REAL credit ledger and the real worker. The queue,
 * rule registry and school row are stubbed; reservations, logs, the unique reference_key and the
 * settle path are real.
 */
describe('GuardianSmsFallbackService metered SMS credit (integration, 67.5.02)', () => {
  let ds: DataSource;
  let logRepo: Repository<CommunicationLog>;
  let credits: SmsCreditService;
  let service: GuardianSmsFallbackService;
  let queued: Array<{ name: string; data: any }>;
  let failAdd: boolean;
  let metered: boolean;
  let classId: string;
  let sectionId: string;
  let rollNo = 7000;
  const stamp = Date.now();
  const TITLE = 'Fee overdue for {studentName}';
  const text = (name: string) => `Sample School: Fee overdue for ${name}`;
  const units = countSmsSegments(text('Rahim')).segments;

  const school = (attention: object = {}, extra: object = {}) => ({
    id: TENANT_ID,
    name: 'Sample School',
    name_bn: null,
    settings: {
      communications: { sms: { provider: 'test', metering: 'PLATFORM' } },
      // no quiet hours: the test must not depend on the clock
      attention: {
        guardianSmsFallback: true,
        guardianSmsDailyCap: 2,
        quietHours: { start: '00:00', end: '00:00' },
        ...attention,
      },
      ...extra,
    },
  });

  const mkUser = async (n: string) =>
    (
      await ds.query(
        `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, 'x', $2, 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [`fallback-${n}-${stamp}@example.com`, `Fallback ${n}`],
      )
    )[0].id as string;
  const mkStudent = async (name: string) =>
    (
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, `FB-${stamp}-${rollNo}`, rollNo++, sectionId, TENANT_ID],
      )
    )[0].id as string;
  const mkGuardian = async (
    studentId: string,
    o: {
      userId?: string | null;
      phone?: string | null;
      optedOut?: boolean;
      name?: string;
      primary?: boolean;
    } = {},
  ) => {
    const [g] = await ds.query(
      `INSERT INTO guardians (full_name, relationship, user_id, phone, notifications_enabled, tenant_id, is_primary_contact)
       VALUES ($1, 'Father', $2, $3, $4, $5, $6) RETURNING id`,
      [
        o.name ?? 'Guardian',
        o.userId ?? null,
        o.phone === undefined ? `+88017${Math.floor(Math.random() * 1e8)}` : o.phone,
        !o.optedOut,
        TENANT_ID,
        !!o.primary,
      ],
    );
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      studentId,
      g.id,
    ]);
    return g.id as string;
  };
  const mkAlert = async (
    studentId: string | null,
    o: { rule?: string; severity?: string; daysAgo?: number; name?: string; params?: object } = {},
  ) =>
    (
      await ds.query(
        `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, dedupe_key, subject_type, subject_id,
                             params, raised_at)
         VALUES ($1, $2, 'RULE', $3, 'FAMILY', gen_random_uuid()::text, $4, $5, $6::jsonb,
                 now() - ($7 || ' days')::interval) RETURNING id`,
        [
          TENANT_ID,
          o.rule ?? 'fees.overdue_family',
          o.severity ?? 'WARNING',
          studentId ? 'student' : null,
          studentId,
          JSON.stringify({ studentName: o.name ?? 'Rahim', ...o.params }),
          String(o.daysAgo ?? 0),
        ],
      )
    )[0].id as string;
  const logs = () => logRepo.find({ where: { tenant_id: TENANT_ID } });

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], []);
    ds = module.get<DataSource>(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
    [{ id: classId }] = await ds.query(
      `INSERT INTO classes (tenant_id, name, academic_year_id)
       VALUES ($1, 'Fallback Class', (SELECT id FROM academic_years WHERE tenant_id = $1 LIMIT 1)) RETURNING id`,
      [TENANT_ID],
    );
    [{ id: sectionId }] = await ds.query(
      `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'F') RETURNING id`,
      [TENANT_ID, classId],
    );
  }, 60000);

  afterAll(async () => {
    if (ds) {
      await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [TENANT_ID]);
      await ds.query(`DELETE FROM students WHERE class_section_id = $1`, [sectionId]);
      await ds.query(`DELETE FROM class_sections WHERE id = $1`, [sectionId]);
      await ds.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      await ds.query(`DELETE FROM users WHERE email LIKE $1`, [`fallback-%-${stamp}@example.com`]);
      await ds.destroy();
    }
  });

  beforeEach(async () => {
    queued = [];
    failAdd = false;
    metered = true;
    await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [TENANT_ID]);
    const real = makeMeteredCreditService(ds);
    await real.grant(TENANT_ID, 100, { idempotencyKey: `seed:fallback:${Math.random()}` });
    credits = real;
    const proxy = Object.create(real, { isMetered: { value: async () => metered } });
    const rule = { messages: { bn: { title: TITLE, why: '', steps: [] }, en: { title: TITLE } } };
    service = new GuardianSmsFallbackService(
      ds,
      {
        add: async (name: string, data: any) => {
          if (failAdd) throw new Error('redis down');
          queued.push({ name, data });
        },
      } as any,
      proxy,
      { get: () => rule } as any,
    );
  }, 30000);

  it('texts guardians without login or push; reserves segments x guardians once; worker settles', async () => {
    const student = await mkStudent('Rahim');
    const noLogin = await mkGuardian(student);
    const loginNoPush = await mkGuardian(student, { userId: await mkUser('a') });
    const withPush = await mkGuardian(student, { userId: await mkUser('b') });
    await mkGuardian(student, { optedOut: true });
    await mkGuardian(student, { phone: null });
    await ds.query(
      `INSERT INTO push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
       SELECT user_id, $1, 'https://push.example/' || gen_random_uuid(), 'k', 'a' FROM guardians WHERE id = $2`,
      [TENANT_ID, withPush],
    );
    const alertId = await mkAlert(student);
    // only the guardian WITH a login has a recipient row; the one without has none (FK to users)
    await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, student_id)
       SELECT $1, $2, user_id, 'PARENT', $3 FROM guardians WHERE id = $4`,
      [TENANT_ID, alertId, student, loginNoPush],
    );

    expect(await service.runTenant(school(), new Date())).toBe(2);

    const rows = await logs();
    expect(rows.map((l) => l.guardian_id).sort()).toEqual([noLogin, loginNoPush].sort());
    expect(rows[0]).toMatchObject({
      trigger: 'AUTOMATED',
      medium: 'SMS',
      student_id: student,
      message_body: text('Rahim'),
    });
    expect(rows.map((l) => l.reference_key).sort()).toEqual(
      [`attention:${alertId}:${noLogin}`, `attention:${alertId}:${loginNoPush}`].sort(),
    );
    const reserves = (await ledgerFor(ds, TENANT_ID)).filter((r) => r.kind === 'RESERVE');
    expect(reserves).toHaveLength(1);
    expect(reserves[0].units).toBe(units * 2);
    expect(reserves[0].idempotency_key).toMatch(
      new RegExp(`^batch:attention:${alertId}:[0-9a-f-]{36}$`),
    );
    expect(queued.every((j) => j.data.segments === units && j.data.batchId)).toBe(true);
    const [rcp] = await ds.query(`SELECT sms_sent_at FROM alert_recipients WHERE alert_id = $1`, [
      alertId,
    ]);
    expect(rcp.sms_sent_at).not.toBeNull();

    const processor = makeProcessor(ds, credits, 'ACCEPTED');
    for (const job of queued) await runJob(processor, job.data);
    expect(await balanceFor(ds, TENANT_ID)).toEqual({ available: 100 - units * 2, reserved: 0 });

    // replay (the next sweep): the reference_key already exists -> no new log, no new reserve
    expect(await service.runTenant(school(), new Date())).toBe(0);
    expect(await logs()).toHaveLength(2);
    expect((await ledgerFor(ds, TENANT_ID)).filter((r) => r.kind === 'RESERVE')).toHaveLength(1);
  });

  it('a second reservation for the same alert settles in full: nothing stranded in reserved', async () => {
    const student = await mkStudent('Rahim');
    await mkGuardian(student);
    await mkAlert(student);
    const processor = makeProcessor(ds, credits, 'ACCEPTED');

    expect(await service.runTenant(school(), new Date())).toBe(1);
    for (const job of queued.splice(0)) await runJob(processor, job.data);

    // a guardian linked later the same day: the next sweep reserves again for the same alert
    await mkGuardian(student);
    expect(await service.runTenant(school(), new Date(Date.now() + 1000))).toBe(1);
    for (const job of queued.splice(0)) await runJob(processor, job.data);

    expect((await ledgerFor(ds, TENANT_ID)).filter((r) => r.kind === 'RESERVE')).toHaveLength(2);
    expect(await balanceFor(ds, TENANT_ID)).toEqual({ available: 100 - units * 2, reserved: 0 });
    expect((await logs()).every((l) => l.metadata?.credit === 'DEBITED')).toBe(true);
  });

  it('insufficient credit: nothing queued, no log, balance unchanged', async () => {
    const student = await mkStudent('Rahim');
    await mkGuardian(student);
    await mkAlert(student);
    await ds.query(`UPDATE sms_credit_balance SET available = 0 WHERE tenant_id = $1`, [TENANT_ID]);
    expect(await service.runTenant(school(), new Date())).toBe(0);
    expect(queued).toEqual([]);
    expect(await logs()).toHaveLength(0);
    expect(await balanceFor(ds, TENANT_ID)).toEqual({ available: 0, reserved: 0 });
  });

  it('unmetered school: queued without a reservation', async () => {
    metered = false;
    const student = await mkStudent('Rahim');
    await mkGuardian(student);
    await mkAlert(student);
    expect(await service.runTenant(school(), new Date())).toBe(1);
    expect(queued[0].data.batchId).toBeUndefined();
    expect((await ledgerFor(ds, TENANT_ID)).filter((r) => r.kind === 'RESERVE')).toHaveLength(0);
  });

  it('queue failure releases the reserved share, closes the log as FAILED, and the next sweep retries', async () => {
    failAdd = true;
    const student = await mkStudent('Rahim');
    await mkGuardian(student);
    await mkAlert(student);
    // cap 1: the FAILED row must not use up the guardian's daily SMS
    await service.runTenant(school({ guardianSmsDailyCap: 1 }), new Date());
    const rows = await logs();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(CommunicationStatus.FAILED);
    // the key is freed so a later sweep can retry this guardian
    expect(rows[0].reference_key).toBeNull();
    expect(await balanceFor(ds, TENANT_ID)).toEqual({ available: 100, reserved: 0 });

    failAdd = false;
    expect(await service.runTenant(school({ guardianSmsDailyCap: 1 }), new Date())).toBe(1);
    expect(queued).toHaveLength(1);
  });

  it('a primary contact without a phone falls back to the other guardians with one', async () => {
    const student = await mkStudent('Rahim');
    await mkGuardian(student, { primary: true, phone: null });
    const other = await mkGuardian(student);
    await mkAlert(student);
    expect(await service.runTenant(school(), new Date())).toBe(1);
    expect((await logs()).map((l) => l.guardian_id)).toEqual([other]);
  });

  it('a primary contact with a phone is the only one texted', async () => {
    const student = await mkStudent('Rahim');
    const primary = await mkGuardian(student, { primary: true });
    await mkGuardian(student);
    await mkAlert(student);
    expect(await service.runTenant(school(), new Date())).toBe(1);
    expect((await logs()).map((l) => l.guardian_id)).toEqual([primary]);
  });

  it('student resolution: params.studentId, then a PARENT recipient row', async () => {
    const s1 = await mkStudent('Rahim');
    const s2 = await mkStudent('Karim');
    const g1 = await mkGuardian(s1);
    const g2 = await mkGuardian(s2);
    // no student subject: the student comes from params.studentId
    const a1 = await mkAlert(null, { params: { studentId: s1 } });
    // no subject, no params.studentId: the student comes from the recipient row
    const a2 = await mkAlert(null, { name: 'Karim' });
    await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, student_id)
       VALUES ($1, $2, $3, 'PARENT', $4)`,
      [TENANT_ID, a2, await mkUser('rcp'), s2],
    );
    expect(await service.runTenant(school(), new Date())).toBe(2);
    const rows = await logs();
    expect(rows.map((l) => [l.reference_key, l.student_id]).sort()).toEqual(
      [
        [`attention:${a1}:${g1}`, s1],
        [`attention:${a2}:${g2}`, s2],
      ].sort(),
    );
  });

  it('run(): one run per tenant across replicas; a lock held elsewhere skips the tenant', async () => {
    const student = await mkStudent('Rahim');
    await mkGuardian(student);
    await mkAlert(student);
    const [{ settings }] = await ds.query(`SELECT settings FROM schools WHERE id = $1`, [
      TENANT_ID,
    ]);
    await ds.query(`UPDATE schools SET settings = $2::jsonb WHERE id = $1`, [
      TENANT_ID,
      JSON.stringify({ ...settings, ...school().settings }),
    ]);
    const lockKey = [ATTENTION_RULE_LOCK_NAMESPACE, `${TENANT_ID}:sms-fallback`];
    // another replica, on its own connection, is mid-run for this tenant
    const replica = ds.createQueryRunner();
    await replica.connect();
    try {
      await replica.query('SELECT pg_advisory_lock($1, hashtext($2))', lockKey);
      await service.run(new Date());
      expect(queued).toEqual([]);

      await replica.query('SELECT pg_advisory_unlock($1, hashtext($2))', lockKey);
      await service.run(new Date());
      expect(queued).toHaveLength(1);
    } finally {
      await replica.release();
      await ds.query(`UPDATE schools SET settings = $2::jsonb WHERE id = $1`, [
        TENANT_ID,
        JSON.stringify(settings),
      ]);
    }
  });

  it('a log that already holds the reference_key releases its share instead of leaking it', async () => {
    const student = await mkStudent('Rahim');
    const g = await mkGuardian(student);
    const alertId = await mkAlert(student);
    // Simulate a concurrent replica: its row lands between our "already sent?" check and our insert.
    const realQuery = ds.query.bind(ds);
    let planted = false;
    ds.query = (async (sql: string, params?: any[]) => {
      if (!planted && /SELECT reference_key FROM communication_logs/.test(sql)) {
        planted = true;
        const result = await realQuery(sql, params);
        await realQuery(
          `INSERT INTO communication_logs (tenant_id, medium, recipient_address, recipient_name, message_body, status, trigger, reference_key)
           VALUES ($1, 'SMS', '+8801700000000', 'x', 'x', 'QUEUED', 'AUTOMATED', $2)`,
          [TENANT_ID, `attention:${alertId}:${g}`],
        );
        return result;
      }
      return realQuery(sql, params);
    }) as any;
    try {
      expect(await service.runTenant(school(), new Date())).toBe(0);
    } finally {
      ds.query = realQuery as any;
    }
    expect(queued).toEqual([]);
    expect(await balanceFor(ds, TENANT_ID)).toEqual({ available: 100, reserved: 0 });
  });

  it('honours guardianSmsDailyCap across alerts', async () => {
    const s1 = await mkStudent('Rahim');
    const s2 = await mkStudent('Karim');
    const g = await mkGuardian(s1);
    await ds.query(`INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`, [
      s2,
      g,
    ]);
    await mkAlert(s1);
    await mkAlert(s2, { name: 'Karim' });
    expect(await service.runTenant(school({ guardianSmsDailyCap: 1 }), new Date())).toBe(1);
    expect(await logs()).toHaveLength(1);
  });

  it('skips: yesterday, REMINDER, a non-fallback rule, no student, school off / no provider / quiet hours', async () => {
    const student = await mkStudent('Rahim');
    await mkGuardian(student);
    await mkAlert(student, { daysAgo: 2 });
    await mkAlert(student, { severity: 'REMINDER' });
    await mkAlert(student, { rule: 'homework.due_tomorrow' });
    await mkAlert(null);
    expect(await service.runTenant(school(), new Date())).toBe(0);

    await mkAlert(student);
    expect(await service.runTenant(school({ guardianSmsFallback: false }), new Date())).toBe(0);
    const noProvider = school();
    (noProvider.settings as any).communications = {};
    expect(await service.runTenant(noProvider, new Date())).toBe(0);
    expect(
      await service.runTenant(
        school({ quietHours: { start: '00:00', end: '23:59' } }),
        new Date('2026-10-10T06:00:00Z'),
      ),
    ).toBe(0);
    expect(await logs()).toHaveLength(0);
    expect(queued).toEqual([]);
  });

  it('child.absent_today: skipped when the absence notice already told this guardian today or will at cutoff', async () => {
    const student = await mkStudent('Rahim');
    const other = await mkStudent('Karim');
    const g = await mkGuardian(student);
    await mkAlert(student, { rule: 'child.absent_today' });
    // an absence log naming this student among several children
    await ds.query(
      `INSERT INTO communication_logs (tenant_id, medium, recipient_address, recipient_name, message_body, subject, status, trigger, guardian_id, metadata)
       VALUES ($1, 'SMS', '+8801700000000', 'x', 'x', 'Absence Notice', 'SENT', 'AUTOMATED', $2, $3::jsonb)`,
      [TENANT_ID, g, JSON.stringify({ student_ids: [student, other] })],
    );
    expect(await service.runTenant(school(), new Date())).toBe(0);

    // same log, but about a different child: not a match
    await ds.query(`UPDATE communication_logs SET metadata = $1::jsonb WHERE guardian_id = $2`, [
      JSON.stringify({ student_ids: [other] }),
      g,
    ]);
    // ... but the school texts absentees at cutoff -> still skipped
    const autoOn = school(
      {},
      { attendance: { autoAbsentNotification: { enabled: true, cutoffTime: '11:00' } } },
    );
    expect(await service.runTenant(autoOn, new Date())).toBe(0);
    expect(await service.runTenant(school(), new Date())).toBe(1);
  });

  // PR #3609 review #5: the staff SMS is a fallback for an app alert nobody read. An admin who
  // already saw it in the app (alert_recipients.seen_at set) is not texted.
  it('staff SMS: skips an admin who already saw the CRITICAL alert in the app', async () => {
    metered = false;
    const seen = await mkUser('staff-seen');
    const unseen = await mkUser('staff-unseen');
    await ds.query(
      `UPDATE users SET phone = '+8801711' || right(id::text, 6) WHERE id = ANY($1::uuid[])`,
      [[seen, unseen]],
    );
    const alertId = await mkAlert(null, {
      rule: 'attendance.not_taken',
      severity: 'CRITICAL',
      params: { sectionLabel: '7-B' },
    });
    await ds.query(
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, seen_at)
       VALUES ($1, $2, $3, 'ADMIN', now()), ($1, $2, $4, 'ADMIN', NULL)`,
      [TENANT_ID, alertId, seen, unseen],
    );
    const staffOnly = school({ guardianSmsFallback: false, staffSmsFallback: true });
    expect(await service.runTenant(staffOnly, new Date())).toBe(1);
    const mine = (await logs()).filter((l) => l.reference_key?.includes(alertId));
    expect(mine.map((l) => l.reference_key)).toEqual([`attention-staff:${alertId}:${unseen}`]);
  });
});
