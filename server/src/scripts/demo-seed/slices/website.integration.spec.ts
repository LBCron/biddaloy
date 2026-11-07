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
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { SiteConfigService } from '../../../modules/website/site-config.service';
import { UmamiService } from '../../../modules/website/umami.service';
import { SiteCacheService } from '../../../modules/website/public/site-cache.service';
import { createContext, type DemoSeedContext } from '../context';
import { slice as org, orgIds } from './org';
import { slice as staff, teachersByTenant } from './staff';
import { slice as website } from './website';

const ANCHOR = '2026-10-10';

/** What one run of the website slice left behind, with ids turned into stable positions. */
interface Facts {
  site: Record<string, any>;
  media: { slot: string; width: number; height: number }[];
  profilePositions: number[];
  featured: number;
  logoKey: string | null;
  posts: { published: number; draft: number };
  enquiries: { all: number; unseen: number };
}

describe('website slice (integration, scale 0.05)', () => {
  let ds: DataSource;
  let app: TestingModule;
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  async function seed(): Promise<Facts> {
    await q(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await q(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await q(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    const ctx: DemoSeedContext = await createContext({
      ds,
      app,
      scale: 0.05,
      years: 2,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await staff.run(ctx);
    await website.run(ctx);
    const T = orgIds(ctx).tenants.find((t) => t.kind === 'HIGH')!.id;
    const teachers = teachersByTenant(ctx).get(T)!;
    const profiles = await q<{ user_id: string; featured: boolean }>(
      `SELECT user_id, featured FROM staff_web_profiles WHERE tenant_id = $1`,
      [T],
    );
    const count = async (table: string, where = 'true') =>
      Number(
        (
          await q(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1 AND ${where}`, [T])
        )[0].n,
      );
    return {
      posts: {
        published: await count('site_posts', 'published_at IS NOT NULL'),
        draft: await count('site_posts', 'published_at IS NULL'),
      },
      enquiries: {
        all: await count('site_enquiries'),
        unseen: await count('site_enquiries', 'seen_at IS NULL'),
      },
      site: (await q(`SELECT * FROM school_sites WHERE tenant_id = $1`, [T]))[0],
      media: await q(`SELECT slot, width, height FROM site_media WHERE tenant_id = $1`, [T]),
      profilePositions: profiles
        .map((p) => teachers.findIndex((t) => t.userId === p.user_id))
        .sort((a, b) => a - b),
      featured: profiles.filter((p) => p.featured).length,
      logoKey: (await q(`SELECT logo_key FROM schools WHERE id = $1`, [T]))[0].logo_key,
    };
  }

  let first: Facts;

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
        SiteConfigService,
        { provide: UmamiService, useValue: { ensureWebsite: vi.fn() } },
        { provide: SiteCacheService, useValue: { invalidate: vi.fn() } },
      ],
      [ConfigModule.forRoot({ isGlobal: true }), AuthModule],
    );
    ds = app.get<DataSource>(getDataSourceToken());
    // The test setup empties data tables before every `it`, so the seed runs here, once.
    // A second run cannot start from scratch in one database (audit_logs is append-only and
    // blocks the school delete); `demo-seed.coverage.integration.spec.ts` compares two fresh
    // databases and so covers "seeded twice gives the same site".
    first = await seed();
  }, 300_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  it('publishes a switched-on Basic site on the school short name with the green palette', () => {
    expect(first.site).toMatchObject({
      subdomain: 'bmsc-high',
      theme: 'basic',
      palette: 'green',
      enabled: true,
      version: 1,
    });
    expect(first.site.published).not.toBeNull();
    expect(first.site.published_at).not.toBeNull();
  });

  it('stores two 1920x1080 hero pictures, sets the school logo, and counts the picture bytes', () => {
    expect(first.media.filter((m) => m.slot === 'hero')).toEqual([
      { slot: 'hero', width: 1920, height: 1080 },
      { slot: 'hero', width: 1920, height: 1080 },
    ]);
    expect(first.logoKey).toContain('/logo/');
    expect(Number(first.site.media_bytes_used)).toBeGreaterThan(0);
  });

  it('publishes the Results page (D12) and a click-to-play video that stores only its id', () => {
    const pages = first.site.published.pages as { page: string; enabled: boolean; sections: any[] }[];
    expect(pages.find((p) => p.page === 'results')).toMatchObject({ enabled: true, sections: [] });
    const video = pages
      .find((p) => p.page === 'home')!
      .sections.find((x) => x.key === 'video')!;
    expect(video).toMatchObject({
      enabled: true,
      data: { videoId: 'aqz-KE-bpKQ', headingPosition: 'below' },
    });
  });

  it('has six teacher cards, three of them featured', () => {
    expect(first.profilePositions).toHaveLength(6);
    expect(first.featured).toBe(3);
  });

  it('has two published posts, one draft, three enquiries (one unseen)', () => {
    expect(first.posts).toEqual({ published: 2, draft: 1 });
    expect(first.enquiries).toEqual({ all: 3, unseen: 1 });
  });
});
