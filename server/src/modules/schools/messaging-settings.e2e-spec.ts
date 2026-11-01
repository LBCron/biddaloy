import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CommunicationMedium, UserRole } from '@biddaloy/shared';
import type { MessagingProvidersResponse, ProviderDescriptor } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_SETTINGS_SCHEMA_VERSION } from './dto/tenant-settings.dto';
import { isEncryptedEnvelope } from './settings/encryption.service';
import { MESSAGING_PROVIDERS } from '../communications/providers/messaging-providers';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const API = '/api/v1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000d9701';
const VERSION = TENANT_SETTINGS_SCHEMA_VERSION;

/**
 * [97 / #3299] Schema-driven messaging settings: validation, masking,
 * encryption at rest, and `GET /schools/:id/settings/messaging/providers`.
 *
 * Uses the REAL provider list, so it needs the providers <-> SchoolsService
 * import cycle to be broken (see the plan, B1). No vendor name is hard-coded:
 * every body is built from the descriptors the API itself returns.
 */
describe('Messaging settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  // A genuine platform SUPER_ADMIN (a membership on the platform school), unlike the seed user,
  // who is a tenant-local SUPER_ADMIN of the seed school (#3346).
  let platformToken: string;
  let platformTenantId: string;

  const req = (
    method: 'get' | 'patch',
    path: string,
    tenant: string | null,
    role: UserRole | null = null,
  ) => {
    let r = supertest(app.getHttpServer())
      [method](`${API}${path}`)
      .set('Authorization', `Bearer ${token}`);
    if (tenant) r = r.set('X-Tenant-ID', tenant);
    return role ? r.set('X-Role', role) : r;
  };
  const providers = (tenant: string, school = tenant) =>
    req('get', `/schools/${school}/settings/messaging/providers`, tenant);
  /** The platform's own SUPER_ADMIN writing `school`'s settings. */
  const platformPatch = (body: object, school = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .patch(`${API}/schools/${school}/settings`)
      .set('Authorization', `Bearer ${platformToken}`)
      .set('X-Tenant-ID', platformTenantId)
      .send({ version: VERSION, ...body });
  const patch = (tenant: string, body: object, school = tenant) =>
    req('patch', `/schools/${school}/settings`, tenant).send({ version: VERSION, ...body });
  const storedBlock = async (school: string, key: string) =>
    (
      await dataSource.query(`SELECT settings #> $2 AS block FROM schools WHERE id = $1`, [
        school,
        ['communications', key],
      ])
    )[0].block;

  // First provider of every medium, every field filled (secret fields get a unique value).
  const fullBody = (res: MessagingProvidersResponse) => {
    const communications: Record<string, unknown> = {};
    const secrets: Record<string, string> = {};
    let n = 0;
    for (const medium of Object.values(CommunicationMedium)) {
      const d: ProviderDescriptor | undefined = res[medium]?.providers[0];
      if (!d) continue;
      const values: Record<string, unknown> = {};
      for (const f of d.fields) {
        n += 1;
        if (f.kind === 'secret')
          values[f.key] = secrets[`${medium}.${f.key}`] = `sec-${n}-abcdefgh`;
        else if (f.kind === 'url') values[f.key] = 'https://vendor.example.test';
        // The schema says which fields are ports (#3322); any other text would be a 400.
        else if (f.format === 'port') values[f.key] = '2525';
        else values[f.key] = `t-${n}`;
      }
      communications[medium.toLowerCase()] = { provider: d.name, [d.name]: values };
    }
    return { communications, secrets };
  };

  beforeAll(async () => {
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
       VALUES ($1, 'Other Messaging Settings School', 'other-messaging-settings-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    // One user holds every role on the seed tenant (X-Role) and ADMIN on a second tenant.
    const memberships: [string, UserRole][] = [
      ...Object.values(UserRole).map((r): [string, UserRole] => [SEED_TENANT_ID, r]),
      [OTHER_TENANT_ID, UserRole.ADMIN],
    ];
    for (const [tenant, role] of memberships) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, tenant, role],
      );
    }
    token = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;

    // Platform authority = SUPER_ADMIN on the 'default-school' tenant (ContextGuard, no
    // PLATFORM_TENANT_ID in tests); same setup as school-admins.controller.e2e-spec.ts.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       SELECT gen_random_uuid(), 'Platform', 'default-school', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'default-school')`,
    );
    [{ id: platformTenantId }] = await dataSource.query(
      `SELECT id FROM schools WHERE slug = 'default-school'`,
    );
    const platformEmail = `metering-platform-${randomUUID().slice(0, 8)}@example.test`;
    const [{ id: platformUserId }] = await dataSource.query(
      `INSERT INTO users (email, password_hash, full_name, status)
       VALUES ($1, $2, 'Metering Platform Admin', 'ACTIVE') RETURNING id`,
      [platformEmail, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`,
      [platformUserId, platformTenantId, UserRole.SUPER_ADMIN],
    );
    platformToken = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: platformEmail, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60000);

  beforeEach(async () => {
    await dataSource.query(`UPDATE schools SET settings = '{}'::jsonb WHERE id = ANY($1)`, [
      [SEED_TENANT_ID, OTHER_TENANT_ID],
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET providers on a fresh tenant lists every registered provider, none configured', async () => {
    const res = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;

    const total = Object.values(res).reduce((sum, m) => sum + (m?.providers.length ?? 0), 0);
    expect(total).toBe(MESSAGING_PROVIDERS.length);
    for (const m of Object.values(res)) expect(m?.configured).toBe(false);
  });

  it('PATCH from the GET schema: 200, secrets masked, encrypted at rest, GET says configured', async () => {
    const schema = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    const { communications, secrets } = fullBody(schema);

    const res = await patch(SEED_TENANT_ID, { communications }).expect(200);

    // Rule 13: no plaintext secret ever comes back.
    for (const secret of Object.values(secrets)) {
      expect(JSON.stringify(res.body)).not.toContain(secret);
    }
    for (const medium of Object.values(CommunicationMedium)) {
      const d = schema[medium]?.providers[0];
      if (!d) continue;
      const block = (await storedBlock(SEED_TENANT_ID, medium.toLowerCase()))[d.name];
      for (const f of d.fields.filter((x) => x.kind === 'secret')) {
        expect(isEncryptedEnvelope(block[f.key])).toBe(true);
        expect(res.body.communications[medium.toLowerCase()][d.name][f.key]).toMatchObject({
          configured: true,
          hint: expect.any(String),
        });
      }
    }
    const after = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    for (const medium of Object.values(CommunicationMedium)) {
      if (!schema[medium]) continue;
      expect(after[medium]?.configured).toBe(true);
      expect(after[medium]?.selected).toBe(schema[medium]?.providers[0].name);
    }
  });

  it('omitted secret is kept, null clears it, empty string is a 400 with the fixed sentence', async () => {
    const schema = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    const medium = Object.values(CommunicationMedium).find((m) =>
      schema[m]?.providers[0].fields.some((f) => f.kind === 'secret'),
    )!;
    const d = schema[medium]!.providers[0];
    const key = medium.toLowerCase();
    const secret = d.fields.find((f) => f.kind === 'secret')!.key;
    const { communications } = fullBody(schema);
    await patch(SEED_TENANT_ID, { communications: { [key]: communications[key] } }).expect(200);
    const before = (await storedBlock(SEED_TENANT_ID, key))[d.name][secret];

    // Omit the secret: the stored value is kept untouched.
    const withoutSecret = {
      provider: d.name,
      [d.name]: Object.fromEntries(
        Object.entries(((communications[key] as any)[d.name] ?? {}) as object).filter(
          ([k]) => k !== secret,
        ),
      ),
    };
    await patch(SEED_TENANT_ID, { communications: { [key]: withoutSecret } }).expect(200);
    expect((await storedBlock(SEED_TENANT_ID, key))[d.name][secret]).toBe(before);

    // Empty string: 400, fixed sentence, nothing stored.
    const empty = { provider: d.name, [d.name]: { ...withoutSecret[d.name], [secret]: '' } };
    const bad = await patch(SEED_TENANT_ID, { communications: { [key]: empty } }).expect(400);
    expect(JSON.stringify(bad.body)).toContain(
      `${secret} must not be empty: leave it out to keep the saved value, or send null to clear it.`,
    );
    expect((await storedBlock(SEED_TENANT_ID, key))[d.name][secret]).toBe(before);

    // null: cleared (#3331: the key is removed); masked as absent and providers says not configured.
    const cleared = { provider: d.name, [d.name]: { ...withoutSecret[d.name], [secret]: null } };
    const res = await patch(SEED_TENANT_ID, { communications: { [key]: cleared } }).expect(200);
    expect(res.body.communications[key][d.name]).not.toHaveProperty(secret);
    expect(await storedBlock(SEED_TENANT_ID, key)).not.toHaveProperty([d.name, secret]);
    const after = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    expect(after[medium]?.configured).toBe(false);
  });

  // #3331: a PATCH keeps a left-out field, so the form sends null for a cleared saved optional
  // field. It must be gone from the stored row and from both GETs; a required one cannot be cleared.
  it('null removes a saved optional field; a required field cannot be cleared', async () => {
    const schema = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    const { communications } = fullBody(schema);
    const found = Object.values(CommunicationMedium)
      .map((m) => ({ m, d: schema[m]?.providers[0] }))
      .find(({ d }) => d?.fields.some((f) => f.kind !== 'secret' && !f.required));
    if (!found) return; // no first provider has an optional text field
    const { m, d } = found as { m: CommunicationMedium; d: ProviderDescriptor };
    const key = m.toLowerCase();
    const optional = d.fields.find((f) => f.kind !== 'secret' && !f.required)!.key;
    await patch(SEED_TENANT_ID, { communications: { [key]: communications[key] } }).expect(200);
    expect((await storedBlock(SEED_TENANT_ID, key))[d.name]).toHaveProperty(optional);

    const res = await patch(SEED_TENANT_ID, {
      communications: { [key]: { provider: d.name, [d.name]: { [optional]: null } } },
    }).expect(200);
    expect(res.body.communications[key][d.name]).not.toHaveProperty(optional);
    expect((await storedBlock(SEED_TENANT_ID, key))[d.name]).not.toHaveProperty(optional);
    const get = await req('get', `/schools/${SEED_TENANT_ID}/settings`, SEED_TENANT_ID).expect(200);
    expect(get.body.communications[key][d.name]).not.toHaveProperty(optional);
    // The rest of the block (secrets included) is untouched.
    for (const f of d.fields.filter((x) => x.key !== optional)) {
      expect((await storedBlock(SEED_TENANT_ID, key))[d.name]).toHaveProperty(f.key);
    }

    const required = d.fields.find((f) => f.kind !== 'secret' && f.required);
    if (required) {
      await patch(SEED_TENANT_ID, {
        communications: { [key]: { provider: d.name, [d.name]: { [required.key]: null } } },
      }).expect(400);
      expect((await storedBlock(SEED_TENANT_ID, key))[d.name]).toHaveProperty(required.key);
    }
  });

  // #3338: "Remove saved details" — provider null plus null for every company. Only `metering`
  // survives, so a PLATFORM school is back on the platform account (selected: null).
  it('provider null with null company blocks removes every saved company and keeps metering', async () => {
    const schema = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    const sms = schema[CommunicationMedium.SMS];
    if (!sms || sms.providers.length < 2) return; // removal by provider null is the multi-company shape
    const { communications } = fullBody(schema);
    // #3346: only the platform (SUPER_ADMIN) may switch a school onto the platform account.
    await platformPatch({
      communications: { sms: { ...(communications.sms as object), metering: 'PLATFORM' } },
    }).expect(200);

    // Review round 2 on #3347: `provider: null` alone would leave the saved blocks behind, so it
    // is refused and nothing changes.
    const saved = await storedBlock(SEED_TENANT_ID, 'sms');
    await patch(SEED_TENANT_ID, { communications: { sms: { provider: null } } }).expect(400);
    expect(await storedBlock(SEED_TENANT_ID, 'sms')).toEqual(saved);

    const nulls = Object.fromEntries(sms.providers.map((d) => [d.name, null]));
    const res = await patch(SEED_TENANT_ID, {
      communications: { sms: { provider: null, ...nulls } },
    }).expect(200);
    expect(res.body.communications.sms).toEqual({ metering: 'PLATFORM' });
    expect(await storedBlock(SEED_TENANT_ID, 'sms')).toEqual({ metering: 'PLATFORM' });
    const after = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    expect(after[CommunicationMedium.SMS]?.selected).toBeNull();
    expect(after[CommunicationMedium.SMS]?.configured).toBe(false);

    // A removal that also sends a value is refused, and nothing changes.
    const first = sms.providers[0];
    await patch(SEED_TENANT_ID, {
      communications: { sms: { provider: null, [first.name]: { apiKey: 'x-abcdefgh' } } },
    }).expect(400);
    expect(await storedBlock(SEED_TENANT_ID, 'sms')).toEqual({ metering: 'PLATFORM' });
  });

  // Review round 1 on #3347: "Remove saved details" on a single-company channel (WhatsApp) sends
  // `{ <sole>: null }` with no provider key. It goes through the real PATCH, the flat/nested shape
  // alignment and the secret encryption step, and leaves no saved secret behind.
  it('a single-company channel: { <sole>: null } removes its saved block, secret included', async () => {
    const schema = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    const medium = CommunicationMedium.WHATSAPP;
    const entry = schema[medium];
    if (!entry || entry.providers.length !== 1) return; // the sole-company shape only
    const d = entry.providers[0];
    const key = medium.toLowerCase();
    const { communications } = fullBody(schema);
    await patch(SEED_TENANT_ID, { communications: { [key]: communications[key] } }).expect(200);
    expect((await providers(SEED_TENANT_ID).expect(200)).body[medium].configured).toBe(true);

    const res = await patch(SEED_TENANT_ID, { communications: { [key]: { [d.name]: null } } });
    expect(res.status).toBe(200);
    expect(res.body.communications[key] ?? {}).not.toHaveProperty(d.name);
    const stored = (await storedBlock(SEED_TENANT_ID, key)) ?? {};
    expect(stored).not.toHaveProperty(d.name);
    for (const f of d.fields) expect(stored).not.toHaveProperty(f.key);
    const after = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    expect(after[medium]?.configured).toBe(false);

    // Removing again (nothing saved) is still a clean 200.
    await patch(SEED_TENANT_ID, { communications: { [key]: { [d.name]: null } } }).expect(200);
  });

  it('an old flat PATCH on a sole-provider medium is accepted; a later nested PATCH keeps the secret', async () => {
    const schema = (await providers(OTHER_TENANT_ID).expect(200))
      .body as MessagingProvidersResponse;
    const medium = Object.values(CommunicationMedium).find(
      (m) => schema[m]?.providers.length === 1,
    );
    if (!medium) return; // no sole-provider medium registered: nothing to be compatible with
    const d = schema[medium]!.providers[0];
    const key = medium.toLowerCase();
    const secret = d.fields.find((f) => f.kind === 'secret');
    const flat = Object.fromEntries(
      d.fields.map((f) => [
        f.key,
        f.kind === 'secret'
          ? 'flat-secret-abcd'
          : f.kind === 'url'
            ? 'https://x.example.test'
            : 'v',
      ]),
    );

    await patch(OTHER_TENANT_ID, { communications: { [key]: flat } }).expect(200);
    expect(Object.keys(await storedBlock(OTHER_TENANT_ID, key))).toContain(d.fields[0].key);

    const nestedNoSecret = Object.fromEntries(
      Object.entries(flat).filter(([k]) => k !== secret?.key),
    );
    await patch(OTHER_TENANT_ID, {
      communications: { [key]: { [d.name]: nestedNoSecret } },
    }).expect(200);
    const block = await storedBlock(OTHER_TENANT_ID, key);
    expect(Object.keys(block)).toEqual([d.name]);
    if (secret) expect(isEncryptedEnvelope(block[d.name][secret.key])).toBe(true);
  });

  it('an unknown provider is a 400 that never echoes the submitted value', async () => {
    const res = await patch(SEED_TENANT_ID, {
      communications: { [CommunicationMedium.SMS.toLowerCase()]: { provider: 'EVIL-123' } },
    }).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('EVIL-123');
  });

  // #3322: the old DTO checked the SMTP port (int 1-65535); the generic validator must too.
  it('an SMTP port that is not 1-65535 is a 400 that never echoes it; a real port saves', async () => {
    const smtp = { host: 'smtp.example.com', user: 'u', password: 'pw', from: 'a@example.com' };
    for (const port of ['EVIL-123', '70000']) {
      const res = await patch(SEED_TENANT_ID, {
        communications: { email: { provider: 'smtp', smtp: { ...smtp, port } } },
      }).expect(400);
      expect(JSON.stringify(res.body)).toContain('port must be a whole number from 1 to 65535.');
      expect(JSON.stringify(res.body)).not.toContain(port);
    }
    await patch(SEED_TENANT_ID, {
      communications: { email: { provider: 'smtp', smtp: { ...smtp, port: '2525' } } },
    }).expect(200);
  });

  it('metering outside SMS is refused (a tenant must not switch on platform keys)', async () => {
    const schema = (await providers(SEED_TENANT_ID).expect(200)).body as MessagingProvidersResponse;
    const { communications } = fullBody(schema);
    const key = CommunicationMedium.WHATSAPP.toLowerCase();
    if (!communications[key]) return;
    await patch(SEED_TENANT_ID, {
      communications: { [key]: { ...(communications[key] as object), metering: 'PLATFORM' } },
    }).expect(400);
  });

  // #3346: `sms.metering` is the platform's. A school ADMIN cannot change it; a SUPER_ADMIN can.
  describe('sms.metering is platform-only', () => {
    const storedMetering = async () =>
      (await storedBlock(SEED_TENANT_ID, 'sms'))?.metering as string | undefined;
    const setStored = (metering: string | null) =>
      dataSource.query(
        `UPDATE schools SET settings = jsonb_set(coalesce(settings, '{}'), '{communications}', coalesce(settings->'communications', '{}') || jsonb_build_object('sms', $2::jsonb)) WHERE id = $1`,
        [SEED_TENANT_ID, JSON.stringify(metering ? { metering } : {})],
      );
    // SMS has several companies, so a valid body names one. PLATFORM needs nothing else (owns nothing);
    // OFF needs a complete block of the school's own.
    // No X-Role means the test user acts as SUPER_ADMIN, so a school caller must say ADMIN.
    const adminPatch = (body: object, school = SEED_TENANT_ID, tenant = SEED_TENANT_ID) =>
      req('patch', `/schools/${school}/settings`, tenant, UserRole.ADMIN).send({
        version: VERSION,
        ...body,
      });
    const sms = (metering: string) => ({
      communications: {
        sms: {
          provider: 'greenweb',
          metering,
          ...(metering === 'OFF' ? { greenweb: { apiKey: 'x-abcdefgh' } } : {}),
        },
      },
    });

    it('a school ADMIN cannot switch an OFF school to PLATFORM (fixed 403, nothing echoed)', async () => {
      await setStored(null);
      const res = await adminPatch(sms('PLATFORM')).expect(403);
      expect(JSON.stringify(res.body)).not.toContain('PLATFORM"');
      expect(await storedMetering()).toBeUndefined();
    });

    it('a school ADMIN cannot switch a PLATFORM school to OFF, but may resend the stored value', async () => {
      await setStored('PLATFORM');
      await adminPatch(sms('OFF')).expect(403);
      expect(await storedMetering()).toBe('PLATFORM');
      await adminPatch(sms('PLATFORM')).expect(200);
      expect(await storedMetering()).toBe('PLATFORM');
    });

    it('an absent stored value counts as OFF: resending OFF is allowed and writes nothing', async () => {
      await setStored(null);
      await adminPatch(sms('OFF')).expect(200);
      expect(await storedMetering()).toBeUndefined();
    });

    it('a SUPER_ADMIN may set it', async () => {
      await setStored(null);
      await platformPatch(sms('PLATFORM')).expect(200);
      expect(await storedMetering()).toBe('PLATFORM');
    });

    it('a tenant-local SUPER_ADMIN of the school (the seed user, no platform membership) may not', async () => {
      await setStored(null);
      await req(
        'patch',
        `/schools/${SEED_TENANT_ID}/settings`,
        SEED_TENANT_ID,
        UserRole.SUPER_ADMIN,
      )
        .send({ version: VERSION, ...sms('PLATFORM') })
        .expect(403);
      expect(await storedMetering()).toBeUndefined();
    });

    it('an invalid value is 400; missing X-Tenant-ID is 401; non-UUID id is 400; another school is 403', async () => {
      await adminPatch(sms('EVIL')).expect(400);
      await req('patch', `/schools/${SEED_TENANT_ID}/settings`, null)
        .send({ version: VERSION, ...sms('PLATFORM') })
        .expect(401);
      await adminPatch(sms('PLATFORM'), 'not-a-uuid').expect(400);
      await adminPatch(sms('PLATFORM'), SEED_TENANT_ID, OTHER_TENANT_ID).expect(403);
    });
  });

  describe('access control and tenant isolation', () => {
    it('missing X-Tenant-ID is 401', async () => {
      await req('get', `/schools/${SEED_TENANT_ID}/settings/messaging/providers`, null).expect(401);
    });

    it('an invalid X-Tenant-ID is refused', async () => {
      const res = await req(
        'get',
        `/schools/${SEED_TENANT_ID}/settings/messaging/providers`,
        'not-a-uuid',
      );
      expect([400, 401, 403]).toContain(res.status);
    });

    it('a non-UUID :id is 400', async () => {
      await providers(SEED_TENANT_ID, 'not-a-uuid').expect(400);
    });

    it("another tenant's ADMIN gets 403", async () => {
      await providers(OTHER_TENANT_ID, SEED_TENANT_ID).expect(403);
    });

    it('a role without SETTINGS_MANAGE gets 403, ADMIN gets 200', async () => {
      const url = `/schools/${SEED_TENANT_ID}/settings/messaging/providers`;
      await req('get', url, SEED_TENANT_ID, UserRole.TEACHER).expect(403);
      await req('get', url, SEED_TENANT_ID, UserRole.ADMIN).expect(200);
    });
  });
});
