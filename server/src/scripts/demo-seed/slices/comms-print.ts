import { createHash } from 'crypto';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  DocumentKind,
  KIND_CONTEXT,
  ReminderBatchStatus,
} from '@biddaloy/shared';
import type { DemoSeedContext, DemoSlice } from '../context';
import { CommunicationLog } from '../../../modules/communications/entities/communication-log.entity';
import { ReminderBatch } from '../../../modules/communications/entities/reminder-batch.entity';
import { SmsCreditLedger } from '../../../modules/communications/credits/entities/sms-credit-ledger.entity';
import { CalendarFeedToken } from '../../../modules/calendar/entities/calendar-feed-token.entity';
import { PrinterProfile } from '../../../modules/print/entities/printer-profile.entity';
import { PrintJob } from '../../../modules/print/entities/print-job.entity';
import { PrintJobItem } from '../../../modules/print/entities/print-job-item.entity';
import { SmsCreditBalance } from '../../../modules/communications/credits/entities/sms-credit-balance.entity';
import { PrintTemplatesService } from '../../../modules/print/templates/print-templates.service';
import { PrintJobsService } from '../../../modules/print/jobs/print-jobs.service';
import { formatArrivalTime } from '../../../modules/attendance/arrival-notice.service';
import { buildEncryptionKey } from '../../../modules/schools/settings/encryption-key';
import { EncryptionService } from '../../../modules/schools/settings/encryption.service';
import { insertChunked } from '../bulk';
import { orgIds, type OrgTenant } from './org';
import { studentIds } from './students';

/**
 * [97.4.04] D27: the company that would have sent each medium, as the worker records it in
 * `metadata.provider`. The demo schools chose OneCodeSoft (`demoMessagingSettings`); PUSH has no
 * company, so its rows carry none. The ids are fake and the sink delivers, so nothing is ever called.
 */
const COMPANY: Partial<Record<CommunicationMedium, string>> = {
  [CommunicationMedium.SMS]: 'onecodesoft',
  [CommunicationMedium.EMAIL]: 'smtp',
};
/** Issue comment on #2176: reminders spend credit, so every branch keeps this much after the history. */
const CREDIT_FLOOR = 10_000;
const CONDUCT = 'সন্তোষজনক';
const MONTH_BN = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

type Kind = 'FEE' | 'OVERDUE' | 'INVOICE' | 'ADMISSION' | 'ABSENCE' | 'RESULT' | 'HOMEWORK';

const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, hh: number, mm = 0) =>
  new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+06:00`);
/** `YYYY-MM-DD` of a moment in Asia/Dhaka (UTC+6, no DST), the inverse of `at`. */
const dhakaDate = (when: Date) =>
  new Date(when.getTime() + 6 * 3_600_000).toISOString().slice(0, 10);

function body(kind: Kind, child: string, date: string): string {
  const month = MONTH_BN[Number(date.slice(5, 7)) - 1];
  switch (kind) {
    case 'FEE':
      return `প্রিয় অভিভাবক, ${child} এর ${month} মাসের ফি তৈরি হয়েছে। নির্ধারিত সময়ের মধ্যে পরিশোধ করুন।`;
    case 'OVERDUE':
      return `প্রিয় অভিভাবক, ${child} এর ${month} মাসের ফি বকেয়া আছে। অনুগ্রহ করে দ্রুত পরিশোধ করুন।`;
    case 'INVOICE':
      return `${child} এর ফি পরিশোধের ইনভয়েস সংযুক্ত করা হলো। ধন্যবাদ।`;
    case 'ADMISSION':
      return `${child} এর ভর্তি সম্পন্ন হয়েছে। আমাদের বিদ্যালয়ে স্বাগতম।`;
    case 'ABSENCE':
      return `প্রিয় অভিভাবক, ${child} আজ বিদ্যালয়ে অনুপস্থিত ছিল।`;
    case 'RESULT':
      return `${child} এর পরীক্ষার ফল প্রকাশিত হয়েছে। বিস্তারিত দেখতে পোর্টালে প্রবেশ করুন।`;
    case 'HOMEWORK':
      return `প্রিয় অভিভাবক, ${child} এর বাড়ির কাজ জমা দেওয়া হয়নি। অনুগ্রহ করে লক্ষ্য রাখুন।`;
  }
}

export const slice: DemoSlice = {
  name: 'comms-print',
  covers: [
    CommunicationLog,
    ReminderBatch,
    SmsCreditBalance,
    SmsCreditLedger,
    CalendarFeedToken,
    PrinterProfile,
    PrintJob,
    PrintJobItem,
  ],
  run: async (ctx) => {
    const org = orgIds(ctx);
    let rows = 0;
    for (const tenant of org.tenants) {
      rows += await messages(ctx, tenant, org.adminUserId);
      rows += await calendarTokens(ctx, tenant, org.adminUserId);
      rows += await printing(ctx, tenant, org.adminUserId);
    }
    rows += await arrivalLogs(ctx);
    // Last, so the extra rng draws shift nothing above.
    return rows + (await messagingSettings(ctx, org.tenants));
  },
};

/** Months of message history, reminder batches and the SMS credit that paid for them. */
async function messages(ctx: DemoSeedContext, tenant: OrgTenant, adminId: string): Promise<number> {
  const rng = ctx.rng;
  const uuid = () => rng.string.uuid();
  const years = tenant.years.slice(-2);
  const mine = studentIds(ctx).students.filter((s) => s.tenantId === tenant.id);
  const names = new Map(
    (
      await ctx.ds.query(
        `SELECT id, COALESCE(full_name_bn, full_name) AS name FROM students WHERE tenant_id = $1`,
        [tenant.id],
      )
    ).map((r: { id: string; name: string }) => [r.id, r.name]),
  );
  // The first guardian of each student (primary contact first): the D26 phone / email.
  const guardian = new Map<
    string,
    { id: string; name: string; phone: string | null; email: string | null }
  >();
  for (const g of await ctx.ds.query(
    `SELECT sg.student_id, g.id, g.full_name AS name, g.phone, g.email
       FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
      WHERE g.tenant_id = $1 ORDER BY g.is_primary_contact DESC, g.id`,
    [tenant.id],
  )) {
    if (!guardian.has(g.student_id)) guardian.set(g.student_id, g);
  }

  const logs: Record<string, unknown>[] = [];
  const debits: { id: string; at: Date }[] = [];
  const seen = new Set<string>(); // (tenant, reference_key) is unique: two random ABSENCE days can land on one date
  const log = (
    kind: Kind,
    studentId: string,
    date: string,
    extra: { trigger?: CommunicationTrigger; batchId?: string } = {},
  ) => {
    const g = guardian.get(studentId);
    if (!g || date > ctx.anchor) return;
    const email = kind === 'INVOICE' && g.email;
    if (!email && !g.phone) return;
    const medium = email ? CommunicationMedium.EMAIL : CommunicationMedium.SMS;
    const drawn = ctx.weighted([
      [CommunicationStatus.SENT, 40],
      [CommunicationStatus.DELIVERED, 58],
      [CommunicationStatus.FAILED, 2],
    ] as const);
    // SMTP has no delivery report, so an email stops at SENT. Remapped after the draw, so the
    // random stream (and every later value: keys, tokens, print jobs) stays the same.
    const status =
      medium === CommunicationMedium.EMAIL && drawn === CommunicationStatus.DELIVERED
        ? CommunicationStatus.SENT
        : drawn;
    const when = at(
      date,
      9 + rng.number.int({ min: 0, max: 7 }),
      rng.number.int({ min: 0, max: 59 }),
    );
    const referenceKey = `demo:${kind}:${studentId}:${date}${extra.batchId ? ':' + extra.batchId : ''}`;
    if (seen.has(referenceKey)) return;
    seen.add(referenceKey);
    const id = uuid();
    logs.push({
      id,
      tenant_id: tenant.id,
      medium,
      recipient_address: email ? g.email : g.phone,
      recipient_name: g.name,
      message_body: body(kind, names.get(studentId) as string, date),
      subject: email ? 'ফি ইনভয়েস' : null,
      status,
      trigger:
        extra.trigger ??
        (kind === 'RESULT' ? CommunicationTrigger.RESULT_SMS : CommunicationTrigger.AUTOMATED),
      student_id: studentId,
      guardian_id: g.id,
      // A reminder round records who started it (RemindersService), so "Sent by" has data.
      sent_by_user_id: extra.batchId ? adminId : null,
      reminder_batch_id: extra.batchId ?? null,
      provider_message_id: status === CommunicationStatus.FAILED ? null : vendorId(medium),
      metadata: {
        provider: COMPANY[medium],
        kind,
        // Any `error` text reads as "Failed" in Why it failed (delivery-error-code.ts).
        ...(status === CommunicationStatus.FAILED ? { error: 'SIMULATED_FAILURE' } : {}),
        // DELIVERED only ever comes from Check status (D23), which records what it read.
        ...(status === CommunicationStatus.DELIVERED ? { delivery: delivered(when) } : {}),
      },
      reference_key: referenceKey,
      created_at: when,
      updated_at: when,
    });
    if (medium === CommunicationMedium.SMS && status !== CommunicationStatus.FAILED) {
      debits.push({ id, at: when });
    }
  };

  /** Same single `rng` draw as before Epic 97, shaped like the company's own id. */
  const vendorId = (medium: CommunicationMedium) => {
    const raw = rng.string.uuid();
    return medium === CommunicationMedium.EMAIL ? `<${raw}@bmsc.example>` : raw;
  };

  for (const year of years) {
    for (const s of mine) {
      const stay = s.stays.find((st) => st.yearId === year.id);
      if (!stay) continue;
      if (s.stays[0].yearId === year.id) log('ADMISSION', s.id, addDays(year.start, -10));
      for (const term of [0, 122, 244]) log('FEE', s.id, addDays(year.start, term + 5));
      if (ctx.rng.number.float() < 0.3)
        log('OVERDUE', s.id, addDays(year.start, 25 + rng.number.int({ min: 0, max: 200 })));
      if (ctx.rng.number.float() < 0.5)
        log('INVOICE', s.id, addDays(year.start, 30 + rng.number.int({ min: 0, max: 200 })));
      for (let i = rng.number.int({ min: 0, max: 2 }); i > 0; i--) {
        log('ABSENCE', s.id, addDays(year.start, 10 + rng.number.int({ min: 0, max: 330 })));
      }
      for (const d of [133, 255]) log('RESULT', s.id, addDays(year.start, d));
      if (ctx.rng.number.float() < 0.3)
        log('HOMEWORK', s.id, addDays(year.start, 20 + rng.number.int({ min: 0, max: 300 })));
    }

    // Fee-reminder batches: three a year, each over a tenth of the branch's students.
    for (const offset of [60, 180, 300]) {
      const date = addDays(year.start, offset);
      if (date > ctx.anchor) continue;
      const batchId = uuid();
      const before = logs.length;
      const pool = mine.filter((s) => s.stays.some((st) => st.yearId === year.id));
      for (const s of pool) {
        if (rng.number.float() < 0.1) {
          log('OVERDUE', s.id, date, { trigger: CommunicationTrigger.BULK_REMINDER, batchId });
        }
      }
      const batch = logs.slice(before);
      const failed = batch.filter((l) => l.status === CommunicationStatus.FAILED).length;
      await ctx.ds.getRepository(ReminderBatch).insert({
        id: batchId,
        tenant_id: tenant.id,
        batch_name: `ফি স্মারক — ${MONTH_BN[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`,
        status: failed ? ReminderBatchStatus.PARTIALLY_FAILED : ReminderBatchStatus.COMPLETED,
        total_recipients: batch.length,
        successful_count: batch.length - failed,
        failed_count: failed,
        message_template: body('OVERDUE', '{{student}}', date),
        initiated_by_user_id: adminId,
        filters_applied: { fee_status: 'DUE' },
        created_at: at(date, 9),
        updated_at: at(date, 9),
      } as never);
    }
  }
  // D28: one "Send a test message" from Settings, shaped like ConnectionTestService writes it, so
  // the Test badge has a row. A guardian's seeded number; no `rng` draw (stableId, anchor time).
  const testTo = [...guardian.values()].find((g) => g.phone)?.phone;
  if (testTo) {
    const id = stableId(`${tenant.slug}:settings-test`);
    const when = at(addDays(ctx.anchor, -1), 11);
    const [school] = await ctx.ds.query(`SELECT name FROM schools WHERE id = $1`, [tenant.id]);
    logs.push({
      id,
      tenant_id: tenant.id,
      medium: CommunicationMedium.SMS,
      recipient_address: testTo,
      recipient_name: 'Test',
      message_body: `Biddaloy test message from ${school.name} — সব ঠিক আছে / all good`,
      subject: null,
      status: CommunicationStatus.SENT,
      trigger: CommunicationTrigger.MANUAL,
      student_id: null,
      guardian_id: null,
      sent_by_user_id: adminId,
      reminder_batch_id: null,
      provider_message_id: id,
      metadata: { test: true, provider: COMPANY[CommunicationMedium.SMS] },
      reference_key: null,
      created_at: when,
      updated_at: when,
    });
    debits.push({ id, at: when });
  }
  companySamples(ctx, tenant, adminId, years[0].start, guardian, names, logs, debits);
  let rows = await insertChunked(ctx.ds.getRepository(CommunicationLog), logs as never);

  // SMS credit: top-ups cover the history and leave CREDIT_FLOOR; the ledger sums to the balance.
  const grantTotal = debits.length + CREDIT_FLOOR;
  const grants = [0, 1, 2].map((i) => Math.floor(grantTotal / 3) + (i === 2 ? grantTotal % 3 : 0));
  const ledger: Record<string, unknown>[] = grants.map((units, i) => ({
    tenant_id: tenant.id,
    kind: 'GRANT',
    units,
    reference_type: 'manual',
    reference_id: null,
    idempotency_key: `demo-grant:${i}`,
    reason: 'ডেমো টপ-আপ',
    actor_user_id: adminId,
    // All before the first log (year start - 10 days), so the running balance never dips below 0.
    created_at: at(addDays(years[0].start, -11), 10 + i),
  }));
  for (const d of debits) {
    ledger.push({
      tenant_id: tenant.id,
      kind: 'DEBIT',
      units: 1,
      reference_type: 'log',
      reference_id: d.id,
      idempotency_key: `demo-debit:${d.id}`,
      reason: null,
      actor_user_id: null,
      created_at: d.at,
    });
  }
  rows += await insertChunked(ctx.ds.getRepository(SmsCreditLedger), ledger as never);
  await ctx.ds.query(
    `INSERT INTO sms_credit_balance (tenant_id, available, reserved) VALUES ($1, $2, 0)
     ON CONFLICT (tenant_id) DO UPDATE SET available = EXCLUDED.available, reserved = 0`,
    [tenant.id, CREDIT_FLOOR],
  );
  return rows + 1;
}

type SeedGuardian = { id: string; name: string; phone: string | null; email: string | null };

/**
 * #3310 acceptance: every Message log Company and Status choice has a row. The history above
 * only uses the school's current companies, so these few rows add the rest, each shaped like
 * its real writer leaves it:
 * - Greenweb and MiMSMS: SENT SMS from the first weeks, before the school moved to OneCodeSoft;
 * - WhatsApp (`meta-cloud`): a manual SENT send from the admin;
 * - Messenger (`meta-page`): FAILED, as every real send is (the provider is a stub, and
 *   reminders never pick Messenger, `DISPATCHABLE_MEDIA`);
 * - an invoice email still QUEUED: no company yet (the worker stamps it at send time), no id.
 * READ is left out: no production path writes it. No `ctx.rng` draw (stableId, dates from the
 * year start and the anchor), so later random values stay the same.
 */
function companySamples(
  ctx: DemoSeedContext,
  tenant: OrgTenant,
  adminId: string,
  yearStart: string,
  guardian: Map<string, SeedGuardian>,
  names: ReadonlyMap<unknown, unknown>,
  logs: Record<string, unknown>[],
  debits: { id: string; at: Date }[],
): void {
  const row = (
    key: string,
    [studentId, g]: [string, SeedGuardian],
    medium: CommunicationMedium,
    status: CommunicationStatus,
    when: Date,
    metadata: Record<string, unknown>,
  ) => {
    const id = stableId(`${tenant.slug}:${key}`);
    const email = medium === CommunicationMedium.EMAIL;
    const kind: Kind = email ? 'INVOICE' : 'FEE';
    logs.push({
      id,
      tenant_id: tenant.id,
      medium,
      recipient_address: email ? g.email : g.phone,
      recipient_name: g.name,
      message_body: body(kind, names.get(studentId) as string, dhakaDate(when)),
      subject: email ? 'ফি ইনভয়েস' : null,
      status,
      trigger: CommunicationTrigger.MANUAL,
      student_id: studentId,
      guardian_id: g.id,
      sent_by_user_id: adminId,
      reminder_batch_id: null,
      provider_message_id: status === CommunicationStatus.SENT ? id : null,
      metadata: { kind, ...metadata },
      reference_key: null,
      created_at: when,
      updated_at: when,
    });
    if (medium === CommunicationMedium.SMS && status === CommunicationStatus.SENT) {
      debits.push({ id, at: when });
    }
  };
  const phoned = [...guardian].find(([, g]) => g.phone);
  const mailed = [...guardian].find(([, g]) => g.email);
  const { SMS, WHATSAPP, MESSENGER, EMAIL } = CommunicationMedium;
  const { SENT, FAILED, QUEUED } = CommunicationStatus;
  if (phoned) {
    row('greenweb', phoned, SMS, SENT, at(addDays(yearStart, 3), 10), { provider: 'greenweb' });
    row('mimsms', phoned, SMS, SENT, at(addDays(yearStart, 4), 10), { provider: 'mimsms' });
    row('whatsapp', phoned, WHATSAPP, SENT, at(addDays(ctx.anchor, -3), 12), {
      provider: 'meta-cloud',
    });
    // Older than any recent-failures window, so no dashboard or alert count moves.
    row('messenger', phoned, MESSENGER, FAILED, at(addDays(ctx.anchor, -40), 12), {
      provider: 'meta-page',
      error: 'Messenger sending is not yet implemented',
    });
  }
  if (mailed) row('queued-email', mailed, EMAIL, QUEUED, at(addDays(ctx.anchor, -1), 15), {});
}

/** What Check status writes for a DELIVERED answer (D23), a few minutes after the send. */
const delivered = (sent: Date) => ({
  status: 'DELIVERED',
  checkedAt: new Date(sent.getTime() + 20 * 60_000).toISOString(),
});

/** A stable uuid-shaped id from a string, so the log ids take no `ctx.rng` draw. */
const stableId = (seed: string) => {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/**
 * [84.3.6] Sent arrival messages, shaped like the real service leaves them (D4, D23):
 * - ACTIVE + every school day: one per school day (up to the last 10) the child was PRESENT/LATE;
 * - a used "Once" (OFF + `consumed_at`): exactly one, at `consumed_at` (that message used it);
 * - ACTIVE "Once" (nothing sent yet), REQUESTED and plain OFF rows: none.
 * Like `ArrivalNoticeService`, a PUSH row whose guardian has no user, and an SMS row with no
 * phone, get nothing. The first branch is the one wired to the gate reader, so it gets the
 * device wording; the others the teacher one. Time text comes from `formatArrivalTime`.
 * No `ctx.rng` draw: the minute and the id are derived from the row, so later slices' random
 * streams do not shift. SMS rows also spend a credit, so ledger and balance still agree.
 */
export async function arrivalLogs(ctx: DemoSeedContext): Promise<number> {
  const subs: {
    id: string;
    tenant_id: string;
    student_id: string;
    guardian_id: string;
    channel: string;
    status: string;
    consumed_at: Date | null;
    name: string;
    guardian: string;
    guardian_user_id: string | null;
    phone: string | null;
    setter: string | null;
  }[] = await ctx.ds.query(
    `SELECT a.id, a.tenant_id, a.student_id, a.guardian_id, a.channel, a.status, a.consumed_at,
            COALESCE(st.full_name_bn, st.full_name) AS name, g.full_name AS guardian,
            g.user_id AS guardian_user_id, g.phone, u.full_name AS setter
       FROM arrival_notice_subscriptions a
       JOIN students st ON st.id = a.student_id
       JOIN guardians g ON g.id = a.guardian_id
       LEFT JOIN users u ON u.id = a.set_by_user_id
      WHERE (a.status = 'ACTIVE' AND a.mode = 'RECURRING')
         OR (a.status = 'OFF' AND a.consumed_at IS NOT NULL)
      ORDER BY a.student_id, a.guardian_id`,
  );
  // Order by student and guardian ids: faker draws them, so they are the same in every seed
  // (measured: two seeds, same 102 student and 129 guardian ids). Never lead with `tenant_id` (a
  // real service makes the schools, so those ids differ per seed) or `a.id` (Postgres draws it).
  // The minute comes from the child's name and the day, never the row order.
  const minuteOf = (name: string, date: string) =>
    parseInt(createHash('sha1').update(`${name}:${date}`).digest('hex').slice(0, 8), 16);
  const firstBranch = orgIds(ctx).tenants[0].id;
  const logs: Record<string, unknown>[] = [];
  const debits: { tenant: string; id: string; at: Date }[] = [];
  for (const sub of subs) {
    const sms = sub.channel === 'SMS';
    if (sms ? !sub.phone : !sub.guardian_user_id) continue;
    let sends: { date: string; when: Date }[];
    if (sub.consumed_at) {
      const when = new Date(sub.consumed_at);
      sends = [{ date: dhakaDate(when), when }];
    } else {
      const days: { date: string }[] = await ctx.ds.query(
        `SELECT DISTINCT to_char(date, 'YYYY-MM-DD') AS date FROM attendance_records
          WHERE tenant_id = $1 AND student_id = $2 AND status IN ('PRESENT', 'LATE') AND date <= $3
          ORDER BY 1 DESC LIMIT 10`,
        [sub.tenant_id, sub.student_id, ctx.anchor],
      );
      sends = days.map(({ date }) => {
        const n = minuteOf(sub.name, date);
        return { date, when: at(date, 7 + (n % 2), 5 + (n % 50)) };
      });
    }
    for (const { date, when } of sends) {
      const time = formatArrivalTime(when, 'Asia/Dhaka', 'bn');
      const body =
        sub.tenant_id === firstBranch
          ? `${sub.name} আজ ${time}-এ স্কুলে পৌঁছেছে — Main Gate Reader।`
          : `${sub.name} আজ ${time}-এ উপস্থিত — ${sub.setter ?? 'অফিস'}।`;
      const referenceKey = `arrival:${date}:${sub.student_id}:${sub.guardian_id}`;
      const id = stableId(`${sub.tenant_id}:${referenceKey}`);
      logs.push({
        id,
        tenant_id: sub.tenant_id,
        medium: sms ? CommunicationMedium.SMS : 'PUSH',
        recipient_address: sms ? sub.phone : `push:${sub.guardian_user_id}`,
        recipient_name: sub.guardian,
        message_body: body,
        subject: 'Arrival Notice',
        status: CommunicationStatus.SENT,
        trigger: CommunicationTrigger.ARRIVAL_NOTICE,
        student_id: sub.student_id,
        guardian_id: sub.guardian_id,
        sent_by_user_id: null,
        // A push has no company and no company id (CommunicationsProcessor.pushToGuardian).
        provider_message_id: sms ? id : null,
        metadata: {
          ...(sms ? { provider: COMPANY[CommunicationMedium.SMS] } : {}),
          kind: 'ARRIVAL',
          subscription_id: sub.id,
        },
        reference_key: referenceKey,
        created_at: when,
        updated_at: when,
      });
      if (sms) debits.push({ tenant: sub.tenant_id, id, at: when });
    }
  }
  if (!logs.length) return 0;
  let rows = await insertChunked(ctx.ds.getRepository(CommunicationLog), logs as never);
  rows += await insertChunked(
    ctx.ds.getRepository(SmsCreditLedger),
    debits.map((d) => ({
      tenant_id: d.tenant,
      kind: 'DEBIT',
      units: 1,
      reference_type: 'log',
      reference_id: d.id,
      idempotency_key: `demo-debit:${d.id}`,
      reason: null,
      actor_user_id: null,
      created_at: d.at,
    })) as never,
  );
  for (const tenant of new Set(debits.map((d) => d.tenant))) {
    await ctx.ds.query(
      `UPDATE sms_credit_balance SET available = available - $2 WHERE tenant_id = $1`,
      [tenant, debits.filter((d) => d.tenant === tenant).length],
    );
  }
  return rows;
}

/** A calendar feed link for the admin and for one class teacher of the branch. */
async function calendarTokens(ctx: DemoSeedContext, tenant: OrgTenant, adminId: string) {
  const teacher: { user_id: string }[] = await ctx.ds.query(
    `SELECT te.user_id FROM teacher_class_sections tcs JOIN teachers te ON te.id = tcs.teacher_id
      WHERE tcs.tenant_id = $1 AND tcs.assignment_type = 'CLASS_TEACHER'
      ORDER BY te.user_id LIMIT 1`,
    [tenant.id],
  );
  const users = [adminId, ...teacher.map((t) => t.user_id)];
  return insertChunked(
    ctx.ds.getRepository(CalendarFeedToken),
    users.map((user_id) => ({
      tenant_id: tenant.id,
      user_id,
      token_hash: createHash('sha256').update(ctx.rng.string.alphanumeric(40)).digest('hex'),
    })) as never,
  );
}

/** Printer profiles, ID and admit card templates, and issued ID cards, admit cards, certificates and TCs. */
async function printing(ctx: DemoSeedContext, tenant: OrgTenant, adminId: string): Promise<number> {
  const templates = ctx.app.get(PrintTemplatesService);
  const jobs = ctx.app.get(PrintJobsService);
  const caller = { tenantId: tenant.id, userId: adminId, role: 'ADMIN' };
  const certCaller = { ...caller, channel: 'CERTIFICATE' as const };
  const q = <T>(sql: string, args: unknown[]): Promise<T[]> => ctx.ds.query(sql, args);
  const year = tenant.years[tenant.years.length - 1];
  let jobCount = 0;

  const printers = await ctx.ds.getRepository(PrinterProfile).save([
    {
      tenant_id: tenant.id,
      name: 'Card printer',
      printer_type: 'CARD',
      margin_top_mm: '0',
      margin_right_mm: '0',
      margin_bottom_mm: '0',
      margin_left_mm: '0',
    },
    {
      tenant_id: tenant.id,
      name: 'Office printer (A4)',
      printer_type: 'OFFICE',
      margin_top_mm: '5',
      margin_right_mm: '5',
      margin_bottom_mm: '5',
      margin_left_mm: '5',
    },
  ] as never);
  const [cardPrinter, officePrinter] = printers as unknown as { id: string }[];

  const publish = async (name: string, suggestion: string) => {
    const t = await templates.create(tenant.id, adminId, {
      name,
      suggestion_key: suggestion,
    } as never);
    await templates.publish(tenant.id, adminId, t.id);
    await templates.setDefault(tenant.id, adminId, t.id);
    const [row] = await q<{ batch_size: number }>(
      `SELECT batch_size FROM print_templates WHERE id = $1`,
      [t.id],
    );
    return { id: t.id, size: row.batch_size };
  };
  const idCard = await publish('Student ID card', 'student-portrait-classic');
  const admit = await publish('Admit card (Bangla)', 'admit-card-bn');

  // The service reads the clock for issuedAt, the printed issue date and serial_year: run it
  // with `Date` frozen at the job's day, so every document derives from the anchor.
  // ponytail: swaps the process-wide `Date` across awaits. Safe only because the seed runs one slice
  // at a time with nothing else in the process; `Date()` without `new` throws while it is swapped.
  // If the seed ever runs work in parallel, post-date the rows with an UPDATE instead (as print_jobs is).
  const withClock = async <T>(when: Date, fn: () => Promise<T>): Promise<T> => {
    const Real = Date;
    const frozen = when.getTime();
    class Frozen extends Real {
      constructor(...a: unknown[]) {
        super(...((a.length ? a : [frozen]) as [number]));
      }
      static now() {
        return frozen;
      }
    }
    globalThis.Date = Frozen as DateConstructor;
    try {
      return await fn();
    } finally {
      globalThis.Date = Real;
    }
  };

  // Templates and printers keep the service's real clock otherwise; date them before the first job.
  const setupAt = at(addDays(year.start, 5), 9);
  await q(`UPDATE printer_profiles SET created_at = $2, updated_at = $2 WHERE id = ANY($1)`, [
    [cardPrinter.id, officePrinter.id],
    setupAt,
  ]);
  await q(`UPDATE print_templates SET created_at = $2, updated_at = $2 WHERE id = ANY($1)`, [
    [idCard.id, admit.id],
    setupAt,
  ]);
  // print_template_versions is immutable (DB trigger): its published_at keeps the run clock.

  /** One real job per chunk, confirmed, then dated (the service stamps the real clock). */
  const run = async (
    c: typeof caller | typeof certCaller,
    dto: Record<string, unknown>,
    subjects: string[],
    size: number,
    date: string,
  ) => {
    for (let i = 0; i < subjects.length; i += size) {
      const when = at(date, 11);
      const job = await withClock(when, () =>
        jobs
          .create(c, {
            ...dto,
            subject_type: 'STUDENT',
            subject_ids: subjects.slice(i, i + size),
          } as never)
          .catch((e) => {
            throw new Error(
              `print job failed (${tenant.slug}, ${String(dto.batch_label ?? dto.template_id)}): ${JSON.stringify((e as { response?: unknown }).response ?? e.message)}`,
            );
          }),
      );
      await withClock(when, () => jobs.confirm(c, job.job_id, []));
      await q(`UPDATE print_jobs SET created_at = $2, confirmed_at = $2 WHERE id = $1`, [
        job.job_id,
        when,
      ]);
      await q(`UPDATE print_job_items SET created_at = $2 WHERE job_id = $1`, [job.job_id, when]);
      jobCount += 1;
    }
  };

  // This year's ID cards for every current student.
  const current = studentIds(ctx).students.filter(
    (s) =>
      s.tenantId === tenant.id &&
      s.status === 'ACTIVE' &&
      s.stays.some((st) => st.yearId === year.id),
  );
  const idDate = addDays(year.start, 20) > ctx.anchor ? ctx.anchor : addDays(year.start, 20);
  await run(
    caller,
    {
      template_id: idCard.id,
      printer_profile_id: cardPrinter.id,
      batch_label: `ID cards ${year.name}`,
    },
    current.map((s) => s.id),
    idCard.size,
    idDate,
  );

  // Admit cards for the next exam: everyone who has a seat.
  const wantedContext = KIND_CONTEXT[DocumentKind.EXAM_ADMIT_CARD];
  for (const exam of await q<{ id: string }>(
    `SELECT e.id FROM exams e WHERE e.tenant_id = $1 AND e.name = 'Annual Exam' AND e.status = 'DRAFT'
        AND e.academic_year_id = $2 ORDER BY e.class_id`,
    [tenant.id, year.id],
  )) {
    const seated = await q<{ student_id: string }>(
      `SELECT DISTINCT a.student_id FROM seat_allocations a JOIN exam_schedules es ON es.id = a.exam_schedule_id
        WHERE es.exam_id = $1 ORDER BY a.student_id`,
      [exam.id],
    );
    await run(
      caller,
      {
        template_id: admit.id,
        printer_profile_id: officePrinter.id,
        context_type: wantedContext,
        context_id: exam.id,
        batch_label: 'Annual Exam admit cards',
      },
      seated.map((r) => r.student_id),
      admit.size,
      addDays(ctx.anchor, -2),
    );
  }

  // About 20 certificates a year across the school, spread over the last 12 months.
  const certificate = async (name: string) =>
    (
      await q<{ id: string }>(
        `SELECT id FROM print_templates WHERE tenant_id = $1 AND name = $2 AND archived_at IS NULL`,
        [tenant.id, name],
      )
    )[0]?.id;
  const testimonial = await certificate('প্রশংসাপত্র (বাংলা)');
  const character = await certificate('চারিত্রিক সনদপত্র (বাংলা)');
  const pool = studentIds(ctx).students.filter(
    (s) => s.tenantId === tenant.id && s.status === 'GRADUATED',
  );
  const wanted = Math.max(3, Math.round(ctx.count(20) / 3));
  for (let i = 0; i < Math.min(wanted, pool.length); i++) {
    const templateId = i % 2 ? character : testimonial;
    if (!templateId) continue;
    await run(
      certCaller,
      {
        template_id: templateId,
        issue_values:
          i % 2 ? { 'issue.conduct': CONDUCT, 'issue.remark': '—' } : { 'issue.conduct': CONDUCT },
      },
      [pool[i].id],
      1,
      addDays(ctx.anchor, -10 - i * 15),
    );
  }

  // A transfer certificate for every Primary -> High transfer of the last two years.
  const tc = await certificate('ছাড়পত্র (বাংলা)');
  const since = tenant.years.slice(-2)[0].start;
  if (tc) {
    for (const t of await q<{ student_id: string; day: string }>(
      `SELECT student_id, occurred_on::text AS day FROM student_lifecycle_events
        WHERE tenant_id = $1 AND event_type = 'TRANSFERRED_OUT' AND occurred_on >= $2
          AND destination LIKE '%মাধ্যমিক শাখা' ORDER BY occurred_on, student_id`,
      [tenant.id, since],
    )) {
      await run(
        certCaller,
        { template_id: tc, issue_values: { 'issue.conduct': CONDUCT, 'issue.remark': '—' } },
        [t.student_id],
        1,
        addDays(t.day, 2),
      );
    }
  }
  return 2 + jobCount;
}

/**
 * Epic 97 (D6): every demo school's Settings > SMS / WhatsApp / Email / Messenger show "Set up", in the
 * per-provider shape. The values are fake (`ctx.rng`, `example.com`); the message sink delivers, so
 * nothing here is ever called. Raw SQL for the same reason as fees.ts: SchoolsService needs the
 * organisation guards, which the slice specs stub.
 */
export function demoMessagingSettings(
  rng: DemoSeedContext['rng'],
  encrypt: (s: string) => string | undefined,
) {
  const token = () => encrypt(rng.string.alphanumeric(32));
  const digits = () => rng.string.numeric(15);
  return {
    sms: {
      provider: 'onecodesoft',
      onecodesoft: {
        apiKey: token(),
        senderId: 'BMSC',
        apiUrl: 'https://sms.bmsc.example/api',
      },
      // No PLATFORM metering: the school sends on its own gateway, so it pays the vendor itself.
    },
    whatsapp: {
      provider: 'meta-cloud',
      'meta-cloud': { phoneNumberId: digits(), accessToken: token() },
    },
    email: {
      provider: 'smtp',
      smtp: {
        host: 'smtp.bmsc.example',
        port: '587',
        user: `demo-${rng.string.alphanumeric(6).toLowerCase()}`,
        password: token(),
        from: 'noreply@bmsc.example',
      },
    },
    messenger: {
      provider: 'meta-page',
      'meta-page': { pageId: digits(), accessToken: token() },
    },
  };
}

async function messagingSettings(ctx: DemoSeedContext, tenants: OrgTenant[]): Promise<number> {
  // Secrets are stored encrypted, like SchoolsService does. No key (a bare local DB): the secret is left
  // out (JSON drops undefined), so the page shows "Not set up" instead of the seed failing.
  const key = buildEncryptionKey(process.env.NODE_ENV, process.env.SETTINGS_ENCRYPTION_KEY);
  const encryption = new EncryptionService(key, []);
  const encrypt = (s: string) => (key ? encryption.encrypt(s) : undefined);
  for (const t of tenants) {
    // One level deep per medium: the seed's keys on a medium block replace the stored ones (a
    // provider block is replaced whole); stored keys the seed does not set, and other media, stay.
    await ctx.ds.query(
      `UPDATE schools SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('communications',
         COALESCE(settings->'communications', '{}'::jsonb) || (
           SELECT jsonb_object_agg(e.key, COALESCE(settings->'communications'->e.key, '{}'::jsonb) || e.value)
             FROM jsonb_each($2::jsonb) AS e))
        WHERE id = $1`,
      [t.id, JSON.stringify(demoMessagingSettings(ctx.rng, encrypt))],
    );
  }
  return tenants.length;
}
