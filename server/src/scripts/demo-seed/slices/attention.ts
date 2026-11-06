import { randomUUID } from 'crypto';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  AlertCadence,
  AlertRecipientState,
  AlertSeverity,
  AlertSource,
  AlertStatus,
  UserRole,
  alertRuleMeta,
  type AlertRuleKey,
} from '@biddaloy/shared';
import { todayInSchoolTz } from '../../../common/time';
import { Alert } from '../../../modules/attention/entities/alert.entity';
import { AlertRecipient } from '../../../modules/attention/entities/alert-recipient.entity';
import { AttentionScheduler } from '../../../modules/attention/engine/attention-scheduler';
import { ManualAlertsService } from '../../../modules/attention/manual/manual-alerts.service';
import { texts as notTakenTexts } from '../../../modules/attention/rules/attendance/attendance-not-taken.rule';
import { addDaysIso } from '../../../modules/attention/rules/rule-context.service';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { todayAt } from '../dates';
import { orgIds, type OrgTenant } from './org';

type Section = { id: string; label: string; className: string };
type HistoryRule = {
  key: AlertRuleKey;
  role?: UserRole;
  params: (s: Section, n: number) => Record<string, string | number>;
};

const notTaken: HistoryRule = {
  key: 'attendance.not_taken',
  params: (s) => ({
    sectionId: s.id,
    sectionLabel: s.label,
    startsAt: '08:00',
    register_en: 'Daily',
    register_bn: 'আজকের',
    ...notTakenTexts(s.label, '08:00', 'Daily', 'আজকের', { unmarked: 0 }),
  }),
};

/**
 * Rules whose alerts fill the history. Each gives the params its own rule writes, so the stored title
 * reads like a real one ("{count} fees became overdue this week" needs `count`). `role` is who gets it:
 * the first role in the rule's own list, except homework, whose section-level alert goes to the teacher.
 */
const HISTORY: HistoryRule[] = [
  notTaken,
  {
    key: 'homework.not_submitted',
    role: UserRole.TEACHER,
    params: (s, n) => {
      const count = 3 + (n % 5);
      return {
        sectionId: s.id,
        sectionLabel: s.label,
        subject_en: 'Mathematics',
        subject_bn: 'গণিত',
        hwTitle: 'Exercise 3.2',
        count,
        headline_en: `${s.label}: ${count} students have not submitted the Mathematics homework`,
        headline_bn: `${s.label}: ${count} জন শিক্ষার্থী গণিত বাড়ির কাজ জমা দেয়নি`,
        step1_en: `Open the homework list for ${s.label}.`,
        step1_bn: `${s.label}-এর বাড়ির কাজের তালিকা খুলুন।`,
        step2_en: 'Remind the students, or mark late submissions.',
        step2_bn: 'শিক্ষার্থীদের মনে করিয়ে দিন, অথবা দেরিতে জমা দেওয়াগুলো চিহ্নিত করুন।',
      };
    },
  },
  {
    key: 'fees.overdue_rising',
    params: (_, n) => ({ count: 4 + (n % 9), students: 3 + (n % 7), amount: 1500 * (4 + (n % 9)) }),
  },
  {
    key: 'exams.marks_overdue',
    params: (s, n) => ({
      exam: 'First Term Exam',
      className: s.className,
      outstanding: 2 + (n % 4),
      days: 3 + (n % 5),
    }),
  },
  notTaken,
  { key: 'admission.applications_pending', params: (_, n) => ({ count: 2 + (n % 6) }) },
];
const roleOf = (h: HistoryRule) => h.role ?? alertRuleMeta(h.key).roles[0];
const HISTORY_PER_BRANCH = 60;
const MIN_HISTORY_PER_BRANCH = 8;

const q = <T = Record<string, any>>(ctx: DemoSeedContext, sql: string, args: unknown[] = []) =>
  ctx.ds.query(sql, args) as Promise<T[]>;

/** First day of the month before the anchor's month. */
const previousMonthStart = (anchor: string): string => {
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7));
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};

/** Up to `n` sections of the branch's current year, spread across its classes. */
function pickSections(t: OrgTenant, n: number): Section[] {
  const all = t.years
    .at(-1)!
    .classes.flatMap((c) =>
      c.sections.map((s) => ({ id: s.id, label: `${c.name}-${s.name}`, className: c.name })),
    );
  const step = Math.max(1, Math.floor(all.length / n));
  return all.filter((_, i) => i % step === 0).slice(0, n);
}

/**
 * Resolved and expired alerts from the whole previous month up to yesterday: the 30-day history, and
 * what the alerts report (it reads the previous local month) shows. Written straight into the tables
 * because the rules only ever raise today's alerts.
 */
async function seedHistory(ctx: DemoSeedContext, t: OrgTenant): Promise<number> {
  const sections = pickSections(t, 4);
  if (!sections.length) return 0;
  const recipients = new Map<UserRole, string[]>();
  for (const role of new Set(HISTORY.map(roleOf))) {
    recipients.set(
      role,
      (
        await q<{ user_id: string }>(
          ctx,
          `SELECT user_id FROM user_tenants
            WHERE tenant_id = $1 AND role::text = $2 AND deleted_at IS NULL ORDER BY user_id`,
          [t.id, role],
        )
      ).map((r) => r.user_id),
    );
  }

  const from = Date.parse(previousMonthStart(ctx.anchor));
  const days = Math.round((Date.parse(ctx.anchor) - from) / 86_400_000); // up to yesterday
  const alerts: QueryDeepPartialEntity<Alert>[] = [];
  const recipientRows: QueryDeepPartialEntity<AlertRecipient>[] = [];
  const total = Math.max(MIN_HISTORY_PER_BRANCH, ctx.count(HISTORY_PER_BRANCH));
  for (let n = 0; n < total; n++) {
    const h = HISTORY[n % HISTORY.length];
    const key = h.key;
    const meta = alertRuleMeta(key);
    const role = roleOf(h);
    const users = recipients.get(role)!;
    if (!users.length) continue;
    const section = sections[n % sections.length];
    const day = new Date(from + ctx.rng.number.int({ min: 0, max: days - 1 }) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const raisedAt = todayAt(day, ctx.rng.number.int({ min: 8, max: 15 }), 0);
    const resolved = n % 4 !== 3; // 3 in 4 are cleared by the teacher, the rest lapse on their own
    const doneAt = resolved
      ? new Date(raisedAt.getTime() + ctx.rng.number.int({ min: 10, max: 90 }) * 60_000)
      : new Date(raisedAt.getTime() + 86_400_000);
    const id = randomUUID();
    alerts.push({
      id,
      tenant_id: t.id,
      rule_key: key,
      source: AlertSource.RULE,
      severity: meta.severity,
      category: meta.category,
      status: resolved ? AlertStatus.RESOLVED : AlertStatus.EXPIRED,
      dedupe_key: `history:${t.slug}:${n}`,
      params: h.params(section, n),
      raised_at: raisedAt,
      last_evaluated_at: raisedAt,
      resolved_at: resolved ? doneAt : null,
      expires_at: resolved ? null : doneAt,
    });
    recipientRows.push({
      tenant_id: t.id,
      alert_id: id,
      user_id: users[n % users.length],
      role,
      state: resolved ? AlertRecipientState.RESOLVED : AlertRecipientState.EXPIRED,
      seen_at: new Date(raisedAt.getTime() + 5 * 60_000),
      resolved_at: doneAt,
    });
  }
  const written = await insertChunked(ctx.ds.getRepository(Alert), alerts);
  return written + (await insertChunked(ctx.ds.getRepository(AlertRecipient), recipientRows));
}

/**
 * Messages the principal and the admin send through the real send path. Roles with few rule alerts
 * (accountant, committee, office desk) still open the app to something, and the "sent by" screen has data.
 */
const MANUAL: { from: 'principal' | 'admin'; roles: UserRole[]; title: string; body: string }[] = [
  {
    from: 'principal',
    roles: [UserRole.TEACHER],
    title: 'Staff meeting after the last period',
    body: 'All teachers please gather in the staff room for a short meeting after the last period.',
  },
  {
    from: 'admin',
    roles: [
      UserRole.TEACHER,
      UserRole.ACCOUNTANT,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
    ],
    title: 'Inspection next week: keep your records ready',
    body: 'The education office visits next week. Please keep registers, files and ledgers up to date.',
  },
  {
    from: 'admin',
    roles: [UserRole.ACCOUNTANT, UserRole.COMMITTEE],
    title: 'Monthly finance review on Sunday',
    body: 'Bring the collection and expense summary for the month to the review meeting.',
  },
  {
    from: 'admin',
    roles: [UserRole.ACCOUNTANT, UserRole.COMMITTEE, UserRole.OFFICE_STAFF],
    title: 'Budget papers are due on Thursday',
    body: 'Please submit your budget proposals to the admin office by Thursday.',
  },
];

async function sendManualAlerts(ctx: DemoSeedContext): Promise<number> {
  const byCard = ctx.ids.get('staffByCardKey') as Map<string, { userId: string; tenantId: string }>;
  const principal = byCard.get('principal');
  if (!principal) return 0;
  const manual = ctx.app.get(ManualAlertsService, { strict: false });
  // The send path checks the end date against the real clock, so it comes from the real clock too.
  const expiresOn = addDaysIso(todayInSchoolTz(), 7);
  for (const m of MANUAL) {
    const sender = m.from === 'admin' ? orgIds(ctx).adminUserId : principal.userId;
    await manual.send(principal.tenantId, sender, {
      severity: AlertSeverity.WARNING,
      title: m.title,
      body: m.body,
      audience: { roles: m.roles },
      expiresOn,
    });
  }
  return MANUAL.length;
}

export const slice: DemoSlice = {
  name: 'attention',
  covers: [Alert, AlertRecipient],
  run: async (ctx) => {
    const tenants = orgIds(ctx).tenants;
    let rows = 0;
    for (const t of tenants) rows += await seedHistory(ctx, t);
    rows += await sendManualAlerts(ctx);

    // Last: the engine's own sweeps derive today's open alerts from everything seeded above (D16).
    // FAST needs a working day inside school hours, DAILY needs the evening slot to have passed.
    const scheduler = ctx.app.get(AttentionScheduler, { strict: false });
    const midday = todayAt(ctx.anchor, 10, 30);
    const evening = todayAt(ctx.anchor, 18, 0);
    for (const t of tenants) {
      await scheduler.sweepTenant(t.id, AlertCadence.FAST, midday);
      await scheduler.sweepTenant(t.id, AlertCadence.HOURLY, midday);
      await scheduler.sweepTenant(t.id, AlertCadence.DAILY, evening);
    }
    const [{ n }] = await q<{ n: number }>(
      ctx,
      `SELECT count(*)::int AS n FROM alerts WHERE status = 'ACTIVE' AND source = 'RULE'`,
    );
    return rows + n;
  },
};
