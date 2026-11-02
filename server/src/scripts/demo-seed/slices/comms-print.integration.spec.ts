import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { PresetApplyService } from '../../../modules/presets/preset-apply.service';
import { PresetRegistryService } from '../../../modules/presets/preset-registry.service';
import { AuthTokenService } from '../../../modules/account-access/auth-token.service';
import { SchoolInviteService } from '../../../modules/account-access/school-invite.service';
import { StaffProfilesService } from '../../../modules/staff-profiles/staff-profiles.service';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { FinalResultsService } from '../../../modules/final-results/final-results.service';
import { AttendanceSummaryService } from '../../../modules/attendance/attendance-summary.service';
import { ResultsService } from '../../../modules/exams/results.service';
import { MarkGridService } from '../../../modules/exams/mark-grid.service';
import { AttendanceComponentService } from '../../../modules/exams/attendance-component.service';
import { MarksAuthorizationService } from '../../../modules/exams/marks-authorization.util';
import { SeatPlansService } from '../../../modules/seat-plans/seat-plans.service';
import { TeacherBusyService } from '../../../modules/routines/teacher-busy.service';
import { ResolveRoutineService } from '../../../modules/routines/resolve-routine.service';
import { createContext } from '../context';
import { slice as org } from './org';
import { slice as students } from './students';
import { slice as extras } from './student-extras';
import { slice as exams } from './exams';
import { slice as commsPrint } from './comms-print';
import { PrintTemplatesService } from '../../../modules/print/templates/print-templates.service';
import { PrintJobsService } from '../../../modules/print/jobs/print-jobs.service';
import { SchoolSettingsReader } from '../../../modules/schools/settings/school-settings-reader.service';

import { problemWith } from '../../../modules/schools/settings/messaging-settings.validator';
import {
  buildMessagingProvidersResponse,
  messagingDescriptors,
} from '../../../modules/schools/settings/messaging-descriptors';
import type { CommunicationMedium } from '@biddaloy/shared';
import { canCheckStatus } from '../../../modules/communications/reminders.service';
import type { CommunicationLog } from '../../../modules/communications/entities/communication-log.entity';

const ANCHOR = '2026-10-10';

describe('comms-print slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let app: TestingModule;
  // Everything is read once, right after the seed (the suite resets data before each `it`).
  const facts: Record<string, any> = {};
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  beforeAll(async () => {
    app = await createTestModule(ALL_ENTITIES, [
      PresetApplyService,
      PresetRegistryService,
      AuditService,
      AuthTokenService,
      SchoolInviteService,
      StaffProfilesService,
      PromotionsService,
      EnrollmentService,
      StudentLifecycleService,
      ResultsService,
      FinalResultsService,
      // Publish snapshots attendance per student; the seed has none in this slice-only run.
      { provide: AttendanceSummaryService, useValue: { getSummariesForStudents: async () => new Map() } },
      MarkGridService,
      SeatPlansService,
      TeacherBusyService,
      PrintTemplatesService,
      PrintJobsService,
      { provide: SchoolSettingsReader, useValue: { documentsSettings: async () => ({}) } },
      { provide: AttendanceComponentService, useValue: {} },
      { provide: MarksAuthorizationService, useValue: {} },
      { provide: ResolveRoutineService, useValue: { resolveTenantDay: async () => [] } },
      { provide: ApprovalService, useValue: { consume: vi.fn() } },
      { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
      { provide: StorageService, useValue: { put: vi.fn(), exists: vi.fn(), get: vi.fn() } },
    ]);
    ds = app.get<DataSource>(getDataSourceToken());
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    const ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await students.run(ctx);
    await extras.run(ctx);
    await exams.run(ctx);
    facts.rows = await commsPrint.run(ctx);

    facts.credit = await q(
      `SELECT b.available, b.reserved,
              COALESCE((SELECT sum(CASE WHEN l.kind = 'GRANT' THEN l.units ELSE -l.units END)
                          FROM sms_credit_ledger l WHERE l.tenant_id = b.tenant_id), 0)::int AS ledger
         FROM sms_credit_balance b`,
    );
    facts.tenants = await q(`SELECT count(*)::int AS n FROM schools WHERE slug LIKE 'bmsc-%'`);
    // Running balance per tenant, in time order: never below zero.
    facts.negative = await q(
      `SELECT count(*)::int AS n FROM (
         SELECT sum(CASE WHEN kind = 'GRANT' THEN units ELSE -units END)
                  OVER (PARTITION BY tenant_id ORDER BY created_at, kind DESC, id) AS running
           FROM sms_credit_ledger) x WHERE running < 0`,
    );
    // Printed documents derive from the anchor, not the run day.
    facts.printDates = await q(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE i.serial_year IS NOT NULL
                AND i.serial_year > extract(year FROM $1::date))::int AS future_serial,
              count(*) FILTER (WHERE (i.data_snapshot->>'issuedAt')::timestamptz > $1::date + 1)::int AS future_issued,
              count(*) FILTER (WHERE i.created_at::date > $1::date)::int AS future_created,
              count(*) FILTER (WHERE i.serial_year IS NOT NULL
                AND i.serial_year <> extract(year FROM (i.data_snapshot->>'issuedAt')::timestamptz
                      AT TIME ZONE 'Asia/Dhaka'))::int AS serial_mismatch
         FROM print_job_items i`,
      [ANCHOR],
    );
    // [97.4.04] Per medium: which company, and whether the company id, delivery and error are set.
    facts.logs = await q(
      `SELECT medium, status, metadata->>'provider' AS provider,
              count(*)::int AS n,
              count(*) FILTER (WHERE provider_message_id IS NULL)::int AS no_vendor_id,
              count(*) FILTER (WHERE metadata #>> '{delivery,status}' = 'DELIVERED'
                                 AND metadata #>> '{delivery,checkedAt}' IS NOT NULL)::int AS delivery,
              count(*) FILTER (WHERE metadata->>'error' IS NOT NULL)::int AS error
         FROM communication_logs GROUP BY 1, 2, 3`,
    );
    facts.testSends = await q(
      `SELECT l.tenant_id, l.trigger, l.medium, l.status, l.sent_by_user_id IS NOT NULL AS has_sender
         FROM communication_logs l WHERE l.metadata->>'test' = 'true'`,
    );
    facts.batchSenders = await q(
      `SELECT count(*) FILTER (WHERE sent_by_user_id IS NULL)::int AS missing
         FROM communication_logs WHERE reminder_batch_id IS NOT NULL`,
    );
    facts.sentSms = await q(
      `SELECT status, medium, provider_message_id, metadata FROM communication_logs
        WHERE medium = 'SMS' AND status = 'SENT' AND metadata->>'provider' = 'onecodesoft' LIMIT 1`,
    );
    facts.batches = await q(
      `SELECT b.total_recipients,
              (SELECT count(*)::int FROM communication_logs l WHERE l.reminder_batch_id = b.id) AS logs
         FROM reminder_batches b`,
    );
    facts.idMissing = await q(
      `SELECT count(*)::int AS n FROM students s
        WHERE s.enrollment_status = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM print_job_items i
           WHERE i.subject_id = s.id AND i.document_kind = 'STUDENT_ID_CARD')`,
    );
    facts.admitMissing = await q(
      `SELECT count(DISTINCT a.student_id)::int AS n FROM seat_allocations a
        WHERE NOT EXISTS (
          SELECT 1 FROM print_job_items i
           WHERE i.subject_id = a.student_id AND i.document_kind = 'EXAM_ADMIT_CARD')`,
    );
    facts.seated = await q(`SELECT count(DISTINCT student_id)::int AS n FROM seat_allocations`);
    facts.tc = await q(
      `SELECT (SELECT count(*)::int FROM print_job_items WHERE document_kind = 'TRANSFER_CERTIFICATE') AS tcs,
              (SELECT count(*)::int FROM student_lifecycle_events
                WHERE event_type = 'TRANSFERRED_OUT' AND destination LIKE '%মাধ্যমিক শাখা') AS transfers`,
    );
    facts.commsSettings = await q(
      `SELECT settings->'communications' AS c FROM schools WHERE slug LIKE 'bmsc-%'`,
    );
    facts.counts = await q(
      `SELECT (SELECT count(*)::int FROM calendar_feed_tokens) AS tokens,
              (SELECT count(*)::int FROM printer_profiles) AS printers,
              (SELECT count(*)::int FROM print_job_items WHERE document_kind IN ('TESTIMONIAL','CHARACTER_CERTIFICATE')) AS certificates`,
    );
  }, 600_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('keeps the SMS credit balance equal to the ledger and above zero', () => {
    expect(facts.credit.length).toBe(facts.tenants[0].n);
    expect(facts.negative[0].n).toBe(0);
    for (const c of facts.credit) {
      expect(c.available).toBe(c.ledger);
      expect(c.available).toBe(10_000);
      expect(c.reserved).toBe(0);
    }
  });

  // [97.4.04] D27: every Message log filter has rows in the demo.
  it('tags each message with the company of its medium, like the worker does', () => {
    const rows = facts.logs as {
      medium: string;
      status: string;
      provider: string | null;
      n: number;
      no_vendor_id: number;
      delivery: number;
      error: number;
    }[];
    // A QUEUED row has no company yet: the worker stamps it at send time.
    const companiesOf: Record<string, (string | null)[]> = {
      SMS: ['onecodesoft', 'greenweb', 'mimsms'],
      WHATSAPP: ['meta-cloud'],
      MESSENGER: ['meta-page'],
      EMAIL: ['smtp'],
      PUSH: [null],
    };
    for (const r of rows) {
      const allowed = r.status === 'QUEUED' ? [null] : companiesOf[r.medium];
      expect(allowed, `${r.medium} ${r.status} ${r.provider}`).toContain(r.provider);
    }
    const sum = (f: (r: (typeof rows)[number]) => boolean, k: keyof (typeof rows)[number] = 'n') =>
      rows.filter(f).reduce((a, r) => a + (r[k] as number), 0);
    // #3310 acceptance: every Company choice and every written Status has a row (READ has no writer).
    for (const { name } of messagingDescriptors()) {
      expect(
        sum((r) => r.provider === name),
        name,
      ).toBeGreaterThan(0);
    }
    for (const st of ['QUEUED', 'SENT', 'DELIVERED', 'FAILED']) {
      expect(
        sum((r) => r.status === st),
        st,
      ).toBeGreaterThan(0);
    }
    // The queued row is an email: an SMS would need a credit RESERVE the seed does not write.
    expect(sum((r) => r.status === 'QUEUED' && r.medium !== 'EMAIL')).toBe(0);
    // Statuses: SMS shows SENT, DELIVERED and FAILED; an email never reads DELIVERED (no report).
    for (const st of ['SENT', 'DELIVERED', 'FAILED']) {
      expect(
        sum((r) => r.medium === 'SMS' && r.status === st),
        st,
      ).toBeGreaterThan(0);
    }
    expect(sum((r) => r.medium === 'EMAIL')).toBeGreaterThan(0);
    expect(sum((r) => r.medium === 'EMAIL' && r.status === 'DELIVERED')).toBe(0);
    // A sent SMS carries the company's id; a failed one none, and an error for Why it failed.
    expect(sum((r) => r.medium === 'SMS' && r.status !== 'FAILED', 'no_vendor_id')).toBe(0);
    expect(sum((r) => r.status === 'FAILED', 'no_vendor_id')).toBe(
      sum((r) => r.status === 'FAILED'),
    );
    expect(sum((r) => r.status === 'FAILED', 'error')).toBe(sum((r) => r.status === 'FAILED'));
    // Every DELIVERED row says what Check status read (D23).
    expect(sum((r) => r.status === 'DELIVERED', 'delivery')).toBe(
      sum((r) => r.status === 'DELIVERED'),
    );
  });

  it('has one Settings test message per branch and a sender on every reminder-round message', () => {
    expect(facts.testSends.length).toBe(facts.tenants[0].n);
    for (const t of facts.testSends) {
      expect(t).toMatchObject({
        trigger: 'MANUAL',
        medium: 'SMS',
        status: 'SENT',
        has_sender: true,
      });
    }
    expect(facts.batchSenders[0].missing).toBe(0);
  });

  // The hosted demo runs on the test inbox (MESSAGE_SINK), which hides Check status by design.
  it('gives a sent SMS everything Check status needs, which the test inbox then hides', () => {
    const log = facts.sentSms[0] as CommunicationLog;
    expect(log).toBeDefined();
    const before = process.env.MESSAGE_SINK;
    try {
      delete process.env.MESSAGE_SINK;
      expect(canCheckStatus(log)).toBe(true);
      process.env.MESSAGE_SINK = 'mailpit';
      expect(canCheckStatus(log)).toBe(false);
    } finally {
      if (before === undefined) delete process.env.MESSAGE_SINK;
      else process.env.MESSAGE_SINK = before;
    }
  });

  it('links each reminder batch to exactly its logs', () => {
    expect(facts.batches.length).toBeGreaterThan(0);
    for (const b of facts.batches) expect(b.logs).toBe(b.total_recipients);
  });

  it('issues an ID card to every current student', () => {
    expect(facts.idMissing[0].n).toBe(0);
  });

  it('issues an admit card to every student with a next-exam seat', () => {
    expect(facts.seated[0].n).toBeGreaterThan(0);
    expect(facts.admitMissing[0].n).toBe(0);
  });

  it('issues one transfer certificate per Primary to High transfer', () => {
    expect(facts.tc[0].transfers).toBeGreaterThan(0);
    expect(facts.tc[0].tcs).toBe(facts.tc[0].transfers);
  });

  // Epic 97 D6: every demo school is "Set up" on all four media, with OneCodeSoft as its SMS company.
  it('stores messaging settings in the per-provider shape: valid, set up, secrets encrypted', () => {
    expect(facts.commsSettings.length).toBe(facts.tenants[0].n);
    for (const { c } of facts.commsSettings) {
      expect(c.sms.provider).toBe('onecodesoft');
      // Its own gateway, so not PLATFORM-metered (the two together would charge credit for a vendor it pays).
      expect(c.sms.metering).toBeUndefined();
      for (const medium of ['SMS', 'WHATSAPP', 'EMAIL', 'MESSENGER'] as const) {
        // The same validator the settings form uses accepts the seeded block.
        expect(problemWith(c[medium.toLowerCase()], medium as CommunicationMedium)).toBeNull();
      }
      const res = buildMessagingProvidersResponse({ version: 1, communications: c } as never);
      expect(res.SMS?.selected).toBe('onecodesoft');
      for (const medium of ['SMS', 'WHATSAPP', 'EMAIL', 'MESSENGER'] as const) {
        expect(res[medium]?.configured).toBe(true);
      }
      // A secret is an encrypted envelope, never the plain value.
      expect(c.sms.onecodesoft.apiKey).toMatch(/^gcmv1:/);
    }
  });

  it('adds calendar tokens, printer profiles and certificates', () => {
    expect(facts.counts[0].tokens).toBeGreaterThanOrEqual(3);
    expect(facts.counts[0].printers).toBe(facts.tenants[0].n * 2);
    expect(facts.counts[0].certificates).toBeGreaterThan(0);
  });

  it('derives print dates and serial years from the anchor, not the run day', () => {
    const d = facts.printDates[0];
    expect(d.n).toBeGreaterThan(0);
    expect(d.future_serial).toBe(0);
    expect(d.future_issued).toBe(0);
    expect(d.future_created).toBe(0);
    expect(d.serial_mismatch).toBe(0);
  });
});
