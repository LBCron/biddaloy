import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole, type OnboardingStatus } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

const TENANT_ID = '00000000-0000-4000-8000-0000001e0401';
const ADMIN_1 = { id: '00000000-0000-4000-8000-0000001e0402', email: 'a1@onboarding-e2e.example' };
const ADMIN_2 = { id: '00000000-0000-4000-8000-0000001e0403', email: 'a2@onboarding-e2e.example' };
const TEACHER = { id: '00000000-0000-4000-8000-0000001e0404', email: 't@onboarding-e2e.example' };

/** [13.3.3] GET /onboarding/status and PATCH /onboarding. */
describe('onboarding E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};

  const get = (token: string) =>
    supertest(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID);
  const patch = (token: string, body: object) =>
    supertest(app.getHttpServer())
      .patch('/api/v1/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send(body);
  const done = (status: OnboardingStatus, id: string) =>
    status.items.find((i) => i.id === id)!.done;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Onboarding E2E School', 'onboarding-e2e-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_ID],
    );
    for (const [user, role] of [
      [ADMIN_1, UserRole.ADMIN],
      [TEACHER, UserRole.TEACHER],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Onboarding E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [user.id, user.email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [user.id, TENANT_ID, role],
      );
    }
    // A second admin who is not a member yet: added later to flip `staff`.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Onboarding E2E 2', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ADMIN_2.id, ADMIN_2.email, SEED_ADMIN_PASSWORD_HASH],
    );

    const loginAs = async (email: string) =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    tokens.admin1 = await loginAs(ADMIN_1.email);
    tokens.teacher = await loginAs(TEACHER.email);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects a TEACHER with 403 on both routes', async () => {
    await get(tokens.teacher).expect(403);
    await patch(tokens.teacher, { seen: true }).expect(403);
  });

  it('rejects a missing token with 401', async () => {
    await supertest(app.getHttpServer()).get('/api/v1/onboarding/status').expect(401);
  });

  it('an empty school has every item undone, zero counts and no trial', async () => {
    const { body } = await get(tokens.admin1).expect(200);
    const status = body as OnboardingStatus;
    expect(status.items.map((i) => i.id)).toHaveLength(8);
    // The seeded admin + teacher are 2 staff, so `staff` is the only item already true.
    for (const item of status.items) {
      expect(item.done).toBe(item.id === 'staff');
    }
    expect(status.counts).toEqual({ classes: 0, sections: 0, students: 0, staff: 2 });
    expect(status.trial).toBeNull();
    expect(status.finished_at).toBeNull();
    expect(status.seen).toBe(false);
  });

  it('creating a class (outside any wizard) flips `structure`; adding a parent flips `guardianInvites`', async () => {
    const [year] = await dataSource.query(
      `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current, created_at, updated_at)
       VALUES ($1, '2027', '2027-01-01', '2027-12-31', true, NOW(), NOW()) RETURNING id`,
      [TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO classes (tenant_id, academic_year_id, name, created_at, updated_at)
       VALUES ($1, $2, 'Class One', NOW(), NOW())`,
      [TENANT_ID, year.id],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [ADMIN_2.id, TENANT_ID, UserRole.PARENT],
    );

    const status = (await get(tokens.admin1).expect(200)).body as OnboardingStatus;
    expect(done(status, 'structure')).toBe(true);
    expect(done(status, 'sections')).toBe(false);
    expect(done(status, 'guardianInvites')).toBe(true);
    // A PARENT membership is not staff.
    expect(status.counts.staff).toBe(2);
    expect(status.counts.classes).toBe(1);
  });

  it('`staff` counts employees once each: a COMMITTEE member and a second role add nothing', async () => {
    const [committee, twoRoles] = await dataSource.query(
      `INSERT INTO users (email, full_name, status, created_at, updated_at)
       VALUES ('c@onboarding-e2e.example', 'Committee', 'ACTIVE', NOW(), NOW()),
              ('two@onboarding-e2e.example', 'Two Roles', 'ACTIVE', NOW(), NOW()) RETURNING id`,
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $3, 'COMMITTEE', NOW(), NOW()),
              ($2, $3, 'TEACHER', NOW(), NOW()), ($2, $3, 'OFFICE_STAFF', NOW(), NOW())`,
      [committee.id, twoRoles.id, TENANT_ID],
    );

    const status = (await get(tokens.admin1).expect(200)).body as OnboardingStatus;
    // Admin + teacher + the two-role member once; committee is not staff (D16).
    expect(status.counts.staff).toBe(3);
  });

  it('PATCH writes flags; `seen` is per user; only schools.onboarding changes', async () => {
    const before = await dataSource.query(
      `SELECT name, settings, seat_limit FROM schools WHERE id = $1`,
      [TENANT_ID],
    );

    const res = await patch(tokens.admin1, {
      setup_path: 'excel',
      seen: true,
      finished: true,
    }).expect(200);
    const status = res.body as OnboardingStatus;
    expect(status.setup_path).toBe('excel');
    expect(status.seen).toBe(true);
    expect(status.finished_at).not.toBeNull();

    // Another admin of the same school has not seen it.
    await dataSource.query(
      `UPDATE user_tenants SET role = $3 WHERE user_id = $1 AND tenant_id = $2`,
      [ADMIN_2.id, TENANT_ID, UserRole.ADMIN],
    );
    tokens.admin2 = (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: ADMIN_2.email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
    expect(((await get(tokens.admin2).expect(200)).body as OnboardingStatus).seen).toBe(false);

    // Un-finishing clears the stamp; dismissing stamps it.
    const cleared = (await patch(tokens.admin1, { finished: false, dismissed: true }).expect(200))
      .body as OnboardingStatus;
    expect(cleared.finished_at).toBeNull();
    expect(cleared.dismissed_at).not.toBeNull();

    const after = await dataSource.query(
      `SELECT name, settings, seat_limit FROM schools WHERE id = $1`,
      [TENANT_ID],
    );
    expect(after).toEqual(before);

    const audit = await dataSource.query(
      `SELECT 1 FROM audit_logs WHERE tenant_id = $1 AND entity_type = 'School' AND entity_id = $1`,
      [TENANT_ID],
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it("PATCH keeps keys it does not own (trial_warnings) and other users' seen_by", async () => {
    await dataSource.query(
      `UPDATE schools SET onboarding = COALESCE(onboarding, '{}'::jsonb)
         || jsonb_build_object('trial_warnings', jsonb_build_array(7), 'seen_by', jsonb_build_array($2::text))
       WHERE id = $1`,
      [TENANT_ID, ADMIN_2.id],
    );
    await patch(tokens.admin1, { seen: true }).expect(200);
    const [row] = await dataSource.query(`SELECT onboarding FROM schools WHERE id = $1`, [
      TENANT_ID,
    ]);
    expect(row.onboarding.trial_warnings).toEqual([7]);
    expect(row.onboarding.seen_by).toEqual(expect.arrayContaining([ADMIN_2.id, ADMIN_1.id]));
  });

  it('rejects an unknown setup_path with 400', async () => {
    await patch(tokens.admin1, { setup_path: 'magic' }).expect(400);
  });

  // [40.2.05] The website item: only for a school that said yes; done once the site is on.
  it('lists the `website` item only after wants_website, and it is done once the site is on', async () => {
    const listed = (s: OnboardingStatus) => s.items.some((i) => i.id === 'website');
    expect(listed((await get(tokens.admin1).expect(200)).body)).toBe(false);

    await patch(tokens.admin1, { wants_website: false }).expect(200);
    expect(listed((await get(tokens.admin1).expect(200)).body)).toBe(false);

    const yes = (await patch(tokens.admin1, { wants_website: true }).expect(200))
      .body as OnboardingStatus;
    expect(yes.items.at(-1)).toEqual({ id: 'website', done: false });

    await dataSource.query(
      `INSERT INTO school_sites (tenant_id, subdomain, palette, draft, enabled)
       VALUES ($1, 'onboarding-e2e-site', 'green', '{}'::jsonb, false)`,
      [TENANT_ID],
    );
    expect(done((await get(tokens.admin1).expect(200)).body, 'website')).toBe(false);

    await dataSource.query(`UPDATE school_sites SET enabled = true WHERE tenant_id = $1`, [
      TENANT_ID,
    ]);
    expect(done((await get(tokens.admin1).expect(200)).body, 'website')).toBe(true);

    // The other answers survive: wants_website is one more key in the same document.
    const [row] = await dataSource.query(`SELECT onboarding FROM schools WHERE id = $1`, [
      TENANT_ID,
    ]);
    expect(row.onboarding.wants_website).toBe(true);
    expect(row.onboarding.seen_by).toEqual(expect.arrayContaining([ADMIN_1.id]));
  });

  it('rejects a non-boolean wants_website with 400', async () => {
    await patch(tokens.admin1, { wants_website: 'yes' }).expect(400);
  });

  it('a missing, malformed or foreign X-Tenant-ID is refused on both routes', async () => {
    for (const tenant of [null, 'not-a-uuid', '00000000-0000-4000-8000-0000001e04ff']) {
      for (const method of ['get', 'patch'] as const) {
        let r = supertest(app.getHttpServer())
          [method](method === 'get' ? '/api/v1/onboarding/status' : '/api/v1/onboarding')
          .set('Authorization', `Bearer ${tokens.admin1}`);
        if (tenant) r = r.set('X-Tenant-ID', tenant);
        const res = await (method === 'patch' ? r.send({ wants_website: true }) : r);
        expect(res.status).toBe(401);
      }
    }
  });
});
