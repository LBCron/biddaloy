import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import type { TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
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
import { TeacherService, UserService } from '../../../modules/users/users.service';
import { AccessTokenDenylistService } from '../../../modules/auth/access-token-denylist.service';
import { SessionCutoffService } from '../../../modules/auth/session-cutoff.service';
import { RefreshTokenService } from '../../../modules/auth/refresh-token.service';
import { ACCESS_TOKEN_TTL_MS } from '../../../modules/auth/auth-tokens';
import { AuthModule } from '../../../modules/auth/auth.module';
import { NoticesModule } from '../../../modules/notices/notices.module';
import { NoticeSmsModule } from '../../../modules/notices/sms/notice-sms.module';
import { NoticeAccessModule } from '../../../modules/notices/access/notice-access.module';
import { NoticeReaderService } from '../../../modules/notices/access/notice-reader.service';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { createContext, type DemoSeedContext } from '../context';
import { slice as org } from './org';
import { slice as staff } from './staff';
import { slice as students, studentIds } from './students';
import { slice as notices } from './notices';

const ANCHOR = '2026-10-10';

describe('notices slice (integration, 2 years, scale 0.05)', () => {
  let ds: DataSource;
  let app: TestingModule;
  let ctx: DemoSeedContext;
  let rows = 0;
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  beforeAll(async () => {
    app = await createTestModule(
      ALL_ENTITIES,
      [
        PresetApplyService,
        PresetRegistryService,
        AuditService,
        AuthTokenService,
        SchoolInviteService,
        StaffProfilesService,
        UserService,
        PromotionsService,
        EnrollmentService,
        StudentLifecycleService,
        { provide: ApprovalService, useValue: { consume: vi.fn() } },
        TeacherService,
        { provide: ACCESS_TOKEN_TTL_MS, useValue: 900_000 },
        {
          provide: AccessTokenDenylistService,
          useValue: { revokeUserTokensIssuedBefore: vi.fn() },
        },
        { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
        { provide: RefreshTokenService, useValue: {} },
        { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
        { provide: StorageService, useValue: { put: async () => undefined } },
      ],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        NoticesModule,
        NoticeAccessModule,
        NoticeSmsModule,
        AuthModule,
      ],
    );
    ds = app.get<DataSource>(getDataSourceToken());
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    ctx = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await staff.run(ctx);
    await students.run(ctx);
    rows = (await notices.run(ctx)) as number;
  }, 300_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  // The test setup empties data tables before every `it`, so everything is read once, right after the seed.
  const facts: Record<string, any> = {};
  beforeAll(async () => {
    facts.byStatus = await q(
      `SELECT status, count(*)::int AS n FROM notices GROUP BY status ORDER BY status`,
    );
    facts.flags = (
      await q(
        `SELECT count(*) FILTER (WHERE pinned)::int AS pinned,
                count(*) FILTER (WHERE important)::int AS important,
                count(*) FILTER (WHERE is_public AND public_token_hash IS NOT NULL)::int AS pub,
                count(*) FILTER (WHERE expires_on < $1::date)::int AS expired,
                count(*) FILTER (WHERE published_at > $1::date + 1)::int AS future,
                count(*) FILTER (WHERE status = 'PUBLISHED' AND sms_status <> 'NONE')::int AS sms
           FROM notices`,
        [ANCHOR],
      )
    )[0];
    facts.sms = await q(
      `SELECT sms_status, count(*)::int AS n FROM notices WHERE sms_status <> 'NONE' GROUP BY sms_status ORDER BY sms_status`,
    );
    facts.smsLogs = await q(
      `SELECT status, recipient_address FROM communication_logs WHERE reference_key LIKE 'notice-sms:%'`,
    );
    facts.files = await q(`SELECT mime_type FROM notice_attachments ORDER BY mime_type`);
    facts.noLogin = (
      await q(
        `SELECT count(*)::int AS n FROM notice_recipients
          WHERE kind = 'GUARDIAN' AND user_id IS NULL`,
      )
    )[0].n;
    facts.kinds = await q(`SELECT DISTINCT kind FROM notice_recipients ORDER BY kind`);
    facts.reads = (
      await q(
        `SELECT count(*) FILTER (WHERE r.seen_at IS NOT NULL)::int AS seen, count(*)::int AS total
           FROM notice_recipients r JOIN notices n ON n.id = r.notice_id
          WHERE n.status = 'PUBLISHED' AND r.user_id IS NOT NULL`,
      )
    )[0];
    facts.acks = (
      await q(`SELECT count(*)::int AS n FROM notice_recipients WHERE acknowledged_at IS NOT NULL`)
    )[0].n;
    const card = studentIds(ctx).cards.guardianUserId;
    const [tenant] = await q(`SELECT tenant_id FROM notice_recipients WHERE user_id = $1 LIMIT 1`, [
      card,
    ]);
    facts.card = await app.get(NoticeReaderService).list(tenant.tenant_id, card, {} as any);
    facts.teacherOwn = (
      await q(
        `SELECT count(*)::int AS n FROM notices n JOIN user_tenants ut ON ut.user_id = n.author_user_id
          WHERE ut.role = 'TEACHER'`,
      )
    )[0].n;
  }, 60_000);

  it('writes 12 notices: 10 published, 1 withdrawn, 1 draft', () => {
    expect(rows).toBe(12);
    expect(facts.byStatus).toEqual([
      { status: 'DRAFT', n: 1 },
      { status: 'PUBLISHED', n: 10 },
      { status: 'WITHDRAWN', n: 1 },
    ]);
  });

  it('has 2 pinned, 1 important, 1 public with a live link, 2 expired; nothing dated after the anchor', () => {
    expect(facts.flags).toMatchObject({ pinned: 2, important: 1, pub: 1, expired: 2, future: 0 });
  });

  it('has an SMS request in every state: pending, approved, declined (one of the two by the system on expiry)', () => {
    expect(facts.sms).toEqual([
      { sms_status: 'APPROVED', n: 1 },
      { sms_status: 'DECLINED', n: 2 },
      { sms_status: 'PENDING', n: 1 },
    ]);
  });

  it('the approved request has SENT and FAILED logs, only to demo numbers (01700-NNNNNN)', () => {
    const statuses = facts.smsLogs.map((l: any) => l.status);
    expect(statuses).toContain('SENT');
    expect(statuses).toContain('FAILED');
    // 01700-000001 is the only phone source in the demo (context.nextPhone): never a real number.
    for (const l of facts.smsLogs) expect(l.recipient_address).toMatch(/^01700-?\d{6}$/);
  });

  it('attaches one PDF and one PNG', () => {
    expect(facts.files).toEqual([{ mime_type: 'application/pdf' }, { mime_type: 'image/png' }]);
  });

  it('mixes staff, student and guardian recipients, including guardians with no login', () => {
    expect(facts.kinds.map((k: any) => k.kind)).toEqual(['GUARDIAN', 'STAFF', 'STUDENT']);
    expect(facts.noLogin).toBeGreaterThan(0);
  });

  it('about 60% of the people with a login have seen their published notices', () => {
    const ratio = facts.reads.seen / facts.reads.total;
    expect(facts.reads.total).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.8);
  });

  it('the important notice has acknowledgements', () => {
    expect(facts.acks).toBeGreaterThan(0);
  });

  it('the guardian card sees 3 notices, the important one not yet acknowledged', () => {
    expect(facts.card.data).toHaveLength(3);
    const important = facts.card.data.filter((i: any) => i.important);
    expect(important).toHaveLength(1);
    expect(important[0].acknowledged).toBe(false);
  });

  it('the demo teacher authored a class notice', () => {
    expect(facts.teacherOwn).toBe(1);
  });
});
