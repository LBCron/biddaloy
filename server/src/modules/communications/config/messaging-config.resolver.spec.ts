import { describe, it, expect, vi } from 'vitest';
import { CommunicationMedium, type TenantSettings } from '@biddaloy/shared';
import { MessagingConfigResolver } from './messaging-config.resolver';
import { ProviderNotConfiguredError } from './provider-not-configured.error';
import { GreenwebProvider } from '../providers/sms/greenweb.provider';
import { MimsmsProvider } from '../providers/sms/mimsms.provider';
import { MetaCloudProvider } from '../providers/whatsapp/meta-cloud.provider';
import { SmtpProvider } from '../providers/email/smtp.provider';
import { MetaPageProvider } from '../providers/messenger/meta-page.provider';
import { OnecodesoftProvider } from '../providers/sms/onecodesoft.provider';
import type { MessagingProvider } from '../providers/messaging-provider';

const providers = [
  new GreenwebProvider(),
  new MimsmsProvider(),
  new MetaCloudProvider(),
  new SmtpProvider(),
  new MetaPageProvider(),
];

function resolverFor(
  settingsByTenant: Record<string, TenantSettings>,
  env: Record<string, string | undefined> = {},
  list: MessagingProvider<any>[] = providers,
) {
  const schools = {
    getDecryptedSettings: vi.fn(async (id: string) => settingsByTenant[id] ?? { version: 1 }),
  };
  // Pass-through cache: no TTL behaviour under test here.
  const cache = { getOrLoad: vi.fn((_id: string, load: () => Promise<unknown>) => load()) };
  const config = { get: vi.fn((k: string) => env[k]) };
  return new MessagingConfigResolver(schools as any, cache as any, config as any, list);
}

const settingsWith = (medium: string, block: Record<string, unknown>): TenantSettings =>
  ({ version: 1, communications: { [medium]: block } }) as unknown as TenantSettings;

/**
 * One row per provider. `full` = every field the tenant saves; `env` = the platform's keys;
 * `flat` = the pre-D6 shape (only WhatsApp / Email / Messenger ever stored it).
 */
interface Row {
  name: string;
  medium: CommunicationMedium;
  key: string; // settings key of the medium
  full: Record<string, string>;
  expected: Record<string, string>;
  env: Record<string, string>;
  partialDrop: string; // required field removed to make a partial block
  destination?: { field: string; value: string };
  flat?: Record<string, unknown>;
}

const rows: Row[] = [
  {
    name: 'greenweb',
    medium: CommunicationMedium.SMS,
    key: 'sms',
    full: { apiKey: 'tk', apiUrl: 'https://g.example/api' },
    expected: { apiKey: 'tk', apiUrl: 'https://g.example/api' },
    env: { GREENWEB_API_KEY: 'env-k', SMS_PROVIDER: 'greenweb' },
    partialDrop: 'apiKey',
    destination: { field: 'apiUrl', value: 'https://new.example/api' },
  },
  {
    name: 'mimsms',
    medium: CommunicationMedium.SMS,
    key: 'sms',
    full: { apiKey: 'tk', senderId: 'S1', apiUrl: 'https://m.example/api' },
    expected: { apiKey: 'tk', senderId: 'S1', apiUrl: 'https://m.example/api' },
    env: { MIMSMS_API_KEY: 'env-k', MIMSMS_SENDER_ID: 'ENV', SMS_PROVIDER: 'mimsms' },
    partialDrop: 'senderId',
    destination: { field: 'apiUrl', value: 'https://new.example/api' },
  },
  {
    name: 'meta-cloud',
    medium: CommunicationMedium.WHATSAPP,
    key: 'whatsapp',
    full: { phoneNumberId: '123', accessToken: 'tk', apiVersion: 'v99.0' },
    expected: { phoneNumberId: '123', accessToken: 'tk', apiVersion: 'v99.0' },
    env: { WHATSAPP_PHONE_NUMBER_ID: '999', WHATSAPP_ACCESS_TOKEN: 'env-tk' },
    partialDrop: 'accessToken',
    flat: { phoneNumberId: '123', accessToken: 'tk', apiVersion: 'v99.0' },
  },
  {
    name: 'smtp',
    medium: CommunicationMedium.EMAIL,
    key: 'email',
    full: { host: 'smtp.example', port: '2525', user: 'u', password: 'pw', from: 'a@x.com' },
    expected: { host: 'smtp.example', port: '2525', user: 'u', password: 'pw', from: 'a@x.com' },
    env: {
      SMTP_HOST: 'env.example',
      SMTP_PORT: '587',
      SMTP_USER: 'eu',
      SMTP_PASSWORD: 'epw',
      SMTP_FROM: 'e@x.com',
    },
    partialDrop: 'password',
    destination: { field: 'host', value: 'attacker.example' },
    flat: { host: 'smtp.example', port: 2525, user: 'u', password: 'pw', from: 'a@x.com' },
  },
  {
    name: 'meta-page',
    medium: CommunicationMedium.MESSENGER,
    key: 'messenger',
    full: { pageId: '55', accessToken: 'tk' },
    expected: { pageId: '55', accessToken: 'tk' },
    env: { MESSENGER_PAGE_ID: '77', MESSENGER_ACCESS_TOKEN: 'env-tk' },
    partialDrop: 'accessToken',
    flat: { pageId: '55', accessToken: 'tk' },
  },
];

describe('MessagingConfigResolver', () => {
  describe.each(rows)('$name', (row) => {
    // SMS has two vendors, so the tenant names one; the others default to their sole provider.
    const nested = (fields: Record<string, unknown>) =>
      settingsWith(row.key, { provider: row.name, [row.name]: fields });
    const selectIf = row.medium === CommunicationMedium.SMS ? { provider: row.name } : {};

    it('tenant-owned: resolves every saved field and returns this provider', async () => {
      const r = await resolverFor({ t1: nested(row.full) }).resolve(row.medium, 't1');
      expect(r.provider.descriptor.name).toBe(row.name);
      expect(r.config).toEqual(row.expected);
    });

    it('tenant-owned: never leaks into another tenant', async () => {
      const resolver = resolverFor({ t1: nested(row.full) });
      await expect(resolver.resolve(row.medium, 't2')).rejects.toBeInstanceOf(
        ProviderNotConfiguredError,
      );
    });

    it('platform: reads <PREFIX>_<FIELD> env when the tenant has no config', async () => {
      const settings =
        row.medium === CommunicationMedium.SMS
          ? settingsWith('sms', { metering: 'PLATFORM' })
          : { version: 1 };
      const r = await resolverFor({ t1: settings as TenantSettings }, row.env).resolve(
        row.medium,
        't1',
      );
      expect(r.provider.descriptor.name).toBe(row.name);
      // every platform env var shows up as the matching field
      const prefix = r.provider.envPrefix;
      for (const [envKey, value] of Object.entries(row.env)) {
        if (!envKey.startsWith(`${prefix}_`)) continue;
        const field = envKey
          .slice(prefix.length + 1)
          .toLowerCase()
          .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        expect(r.config[field]).toBe(value);
      }
    });

    it('override: wins over the tenant value, field by field', async () => {
      const field = Object.keys(row.full).find((k) => !['host', 'port', 'apiUrl'].includes(k))!;
      const r = await resolverFor({ t1: nested(row.full) }).resolve(row.medium, 't1', {
        override: { ...selectIf, [row.name]: { [field]: 'draft' } },
      });
      expect(r.config[field]).toBe('draft');
      for (const [k, v] of Object.entries(row.expected))
        if (k !== field) expect(r.config[k]).toBe(v);
    });

    it('partial: a tenant that touched the medium never falls back to platform env', async () => {
      const { [row.partialDrop]: _dropped, ...partial } = row.full;
      const resolver = resolverFor({ t1: nested(partial) }, row.env);
      const err = await resolver.resolve(row.medium, 't1').catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).toMatch(/never falls back to the platform account/);
    });

    it('partial: an explicitly cleared secret fails closed, env is not used', async () => {
      const secret = row.partialDrop;
      const resolver = resolverFor({ t1: nested({ ...row.full, [secret]: null }) }, row.env);
      await expect(resolver.resolve(row.medium, 't1')).rejects.toThrow(
        /never falls back to the platform account/,
      );
    });

    if (row.destination) {
      it('override sets the destination: must carry every required field, nothing borrowed', async () => {
        const resolver = resolverFor({ t1: nested(row.full) }, row.env);
        const err = await resolver
          .resolve(row.medium, 't1', {
            override: {
              ...selectIf,
              [row.name]: { [row.destination!.field]: row.destination!.value },
            },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/requires .* together \(missing: /);
        // the stored secret is never in the error
        expect(err.message).not.toContain('pw');
      });

      it('override sets the destination with a full draft: resolves from the draft alone', async () => {
        const draft = { ...row.full, [row.destination!.field]: row.destination!.value };
        const r = await resolverFor({ t1: nested({ ...row.full, apiKey: 'stored' }) }).resolve(
          row.medium,
          't1',
          { override: { ...selectIf, [row.name]: draft } },
        );
        expect(r.config[row.destination!.field]).toBe(row.destination!.value);
      });
    }

    if (row.medium === CommunicationMedium.SMS) {
      it('not-on-credit: no own gateway, not PLATFORM-metered, no allowPlatformKeys -> notOnCredit', async () => {
        const resolver = resolverFor({ t1: settingsWith('sms', { provider: row.name }) }, row.env);
        await expect(resolver.resolve(row.medium, 't1')).rejects.toThrow(
          /not on prepaid SMS credit/,
        );
      });

      it('allowPlatformKeys: an account-access send uses the platform keys without metering', async () => {
        const resolver = resolverFor({ t1: settingsWith('sms', { provider: row.name }) }, row.env);
        const r = await resolver.resolve(row.medium, 't1', { allowPlatformKeys: true });
        expect(r.config.apiKey).toBe('env-k');
      });
    } else {
      it('platform fallback is always on for a medium without metering', async () => {
        const r = await resolverFor({ t1: { version: 1 } }, row.env).resolve(row.medium, 't1');
        expect(Object.keys(r.config).length).toBeGreaterThan(0);
      });
    }

    if (row.flat) {
      it('old flat shape (pre-D6) still resolves', async () => {
        const r = await resolverFor({ t1: settingsWith(row.key, row.flat!) }).resolve(
          row.medium,
          't1',
        );
        expect(r.config).toEqual(row.expected);
      });

      it('old flat shape: nested block wins when both exist', async () => {
        const r = await resolverFor({
          t1: settingsWith(row.key, { ...row.flat!, [row.name]: row.full }),
        }).resolve(row.medium, 't1');
        expect(r.config).toEqual(row.expected);
      });
    }
  });

  describe('provider selection', () => {
    it('unknown provider name: fixed error, the name is not echoed', async () => {
      const resolver = resolverFor({
        t1: settingsWith('sms', { provider: 'evil<script>' }),
      });
      const err = await resolver.resolve(CommunicationMedium.SMS, 't1').catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).not.toContain('evil');
    });

    it('unknown provider name in an override is not echoed either', async () => {
      const err = await resolverFor({})
        .resolve(CommunicationMedium.SMS, 't1', { override: { provider: 'nope-vendor' } })
        .catch((e) => e);
      expect(err.message).not.toContain('nope-vendor');
    });

    it('a single-provider medium ignores a stray provider key (tenant and override)', async () => {
      const stray = settingsWith('whatsapp', {
        provider: 'x',
        'meta-cloud': { phoneNumberId: 'p1', accessToken: 'tok' },
      });
      const r = await resolverFor({ t1: stray }).resolve(CommunicationMedium.WHATSAPP, 't1');
      expect(r.provider.descriptor.name).toBe('meta-cloud');
      const o = await resolverFor({ t1: stray }).resolve(CommunicationMedium.WHATSAPP, 't1', {
        override: { provider: 'nope-vendor' },
      });
      expect(o.provider.descriptor.name).toBe('meta-cloud');
    });

    it('a provider of another medium is not selectable', async () => {
      await expect(
        resolverFor({}).resolve(CommunicationMedium.SMS, 't1', { override: { provider: 'smtp' } }),
      ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    });

    it('a medium with no provider (PHONE_CALL) is the same fixed error', async () => {
      await expect(resolverFor({}).resolve(CommunicationMedium.PHONE_CALL, 't1')).rejects.toThrow(
        ProviderNotConfiguredError,
      );
    });

    it('SMS with two vendors: the platform picks by SMS_PROVIDER', async () => {
      const r = await resolverFor(
        {},
        { SMS_PROVIDER: 'mimsms', MIMSMS_API_KEY: 'k', MIMSMS_SENDER_ID: 's' },
      ).resolve(CommunicationMedium.SMS, null, { allowPlatformKeys: true });
      expect(r.provider.descriptor.name).toBe('mimsms');
    });

    it('SMS with two vendors and no choice defaults to the first (greenweb)', async () => {
      const r = await resolverFor({}, { GREENWEB_API_KEY: 'k' }).resolve(
        CommunicationMedium.SMS,
        null,
        { allowPlatformKeys: true },
      );
      expect(r.provider.descriptor.name).toBe('greenweb');
    });

    it('tenant provider choice beats SMS_PROVIDER', async () => {
      const r = await resolverFor(
        { t1: settingsWith('sms', { provider: 'greenweb', greenweb: { apiKey: 'k' } }) },
        { SMS_PROVIDER: 'mimsms' },
      ).resolve(CommunicationMedium.SMS, 't1', { allowPlatformKeys: true });
      expect(r.provider.descriptor.name).toBe('greenweb');
    });

    it('platform sender (tenantId null) reads no school settings', async () => {
      const r = await resolverFor(
        {},
        { WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' },
      ).resolve(CommunicationMedium.WHATSAPP, null);
      expect(r.config).toEqual({ phoneNumberId: '1', accessToken: 't' });
    });
  });

  describe('settings cache', () => {
    it('reads settings through TenantSettingsCache keyed by tenant id; two tenants never leak', async () => {
      const settingsByTenant: Record<string, TenantSettings> = {
        'tenant-a': settingsWith('messenger', { pageId: '1', accessToken: 'token-a' }),
        'tenant-b': settingsWith('messenger', { pageId: '2', accessToken: 'token-b' }),
      };
      const getOrLoad = vi.fn((_id: string, load: () => Promise<unknown>) => load());
      const resolver = new MessagingConfigResolver(
        { getDecryptedSettings: async (id: string) => settingsByTenant[id] } as any,
        { getOrLoad } as any,
        { get: () => undefined } as any,
        providers,
      );

      const a = await resolver.resolve(CommunicationMedium.MESSENGER, 'tenant-a');
      const b = await resolver.resolve(CommunicationMedium.MESSENGER, 'tenant-b');

      expect(getOrLoad.mock.calls.map((c) => c[0])).toEqual(['tenant-a', 'tenant-b']);
      expect(a.config.accessToken).toBe('token-a');
      expect(b.config.accessToken).toBe('token-b');
    });

    it('the platform sender (null tenant) never touches the cache', async () => {
      const getOrLoad = vi.fn();
      const resolver = new MessagingConfigResolver(
        {} as any,
        { getOrLoad } as any,
        { get: (k: string) => ({ MESSENGER_PAGE_ID: '9', MESSENGER_ACCESS_TOKEN: 't' })[k] } as any,
        providers,
      );

      await resolver.resolve(CommunicationMedium.MESSENGER, null);

      expect(getOrLoad).not.toHaveBeenCalled();
    });
  });

  describe('field rules', () => {
    it('platform email resolves with SMTP_PORT unset (the provider defaults 587)', async () => {
      const r = await resolverFor(
        {},
        { SMTP_HOST: 'h.example', SMTP_USER: 'u', SMTP_PASSWORD: 'p', SMTP_FROM: 'a@x.com' },
      ).resolve(CommunicationMedium.EMAIL, 't1');

      expect(r.config).toEqual({ host: 'h.example', user: 'u', password: 'p', from: 'a@x.com' });
    });

    it('optional non-credential fields (apiVersion) resolve independently of ownership', async () => {
      const r = await resolverFor(
        { t1: settingsWith('whatsapp', { apiVersion: 'v30.0' }) },
        { WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't' },
      ).resolve(CommunicationMedium.WHATSAPP, 't1');
      expect(r.config).toEqual({ phoneNumberId: '1', accessToken: 't', apiVersion: 'v30.0' });
    });

    it('owned optional field (senderId): a school with its own key never gets the platform sender id', async () => {
      // PLATFORM metering makes the env reachable, so only the `owned` flag keeps it out.
      const env = { ONECODESOFT_API_KEY: 'env-k', ONECODESOFT_SENDER_ID: 'PLATFORM-ID' };
      const settings = settingsWith('sms', {
        provider: 'onecodesoft',
        metering: 'PLATFORM',
        onecodesoft: { apiKey: 'own-k', apiUrl: 'https://o.example/api' },
      });
      const r = await resolverFor({ t1: settings }, env, [new OnecodesoftProvider()]).resolve(
        CommunicationMedium.SMS,
        't1',
      );
      expect(r.config).toEqual({ apiKey: 'own-k', apiUrl: 'https://o.example/api' });
    });

    it('owned optional field (senderId): the platform account keeps its own sender id', async () => {
      const env = {
        ONECODESOFT_API_KEY: 'env-k',
        ONECODESOFT_API_URL: 'https://p.example/api',
        ONECODESOFT_SENDER_ID: 'PLATFORM-ID',
      };
      const settings = settingsWith('sms', { provider: 'onecodesoft', metering: 'PLATFORM' });
      const r = await resolverFor({ t1: settings }, env, [new OnecodesoftProvider()]).resolve(
        CommunicationMedium.SMS,
        't1',
      );
      expect(r.config.senderId).toBe('PLATFORM-ID');
    });

    it('SMTP port is a destination: an override port never borrows the stored credentials', async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const err = await resolverFor({ t1: stored })
        .resolve(CommunicationMedium.EMAIL, 't1', { override: { smtp: { port: '25' } } })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).toMatch(/requires .* together/);
    });

    // Review round 2, item 4: `from` is send-only, so a connection test of a new SMTP server needs
    // only the server and its login. Nothing is borrowed: the stored `from` stays out of the result too.
    it('SMTP connection test with a new destination needs no `from`', async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const r = await resolverFor({ t1: stored }).resolve(CommunicationMedium.EMAIL, 't1', {
        override: { smtp: { host: 'new.example', user: 'nu', password: 'npw' } },
        connectionTestOnly: true,
      });
      expect(r.config).toEqual({ host: 'new.example', user: 'nu', password: 'npw' });
    });

    // Review round 3, item 3: a test message really sends, so it needs `from` too; the stored one
    // is never borrowed for a new destination.
    it('a send to a new SMTP destination (no connectionTestOnly) still requires `from`', async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const err = await resolverFor({ t1: stored })
        .resolve(CommunicationMedium.EMAIL, 't1', {
          override: { smtp: { host: 'new.example', user: 'nu', password: 'npw' } },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).toMatch(/requires host, user, password, from together \(missing: from\)/);
    });

    // Review round 3, item 5: SMS has several providers and was never stored flat, so flat vendor
    // keys on `communications.sms` are not read (the validator rejects them too).
    it('multi-provider SMS ignores flat vendor keys (tenant and override)', async () => {
      const env = { GREENWEB_API_KEY: 'env-k' };
      const flat = settingsWith('sms', { provider: 'greenweb', apiKey: 'flat-k' });
      const resolver = resolverFor({ t1: flat }, env);
      await expect(resolver.resolve(CommunicationMedium.SMS, 't1')).rejects.toThrow(
        /not on prepaid SMS credit/,
      );
      const r = await resolver.resolve(CommunicationMedium.SMS, 't1', {
        allowPlatformKeys: true,
        override: { provider: 'greenweb', apiKey: 'flat-override' },
      });
      expect(r.config.apiKey).toBe('env-k');
    });

    it('a stored send without an override still requires `from`', async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw' },
      });
      await expect(
        resolverFor({ t1: stored }).resolve(CommunicationMedium.EMAIL, 't1'),
      ).rejects.toThrow(/Complete host, user, password, from together/);
    });

    // Review round 2, item 5: '' is "not filled in", so it neither sets a destination nor claims
    // the medium. #3338 changed the stored null the same way: the merge now removes a cleared key,
    // and an older stored null reads as unset, as the validator already did.
    it("a blank override destination ('') does not count as a new destination", async () => {
      const stored = settingsWith('email', {
        smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const r = await resolverFor({ t1: stored }).resolve(CommunicationMedium.EMAIL, 't1', {
        override: { smtp: { host: '', port: '' } },
      });
      expect(r.config).toEqual({
        host: 'smtp.example',
        user: 'u',
        password: 'pw',
        from: 'a@x.com',
      });
    });

    it("a stored blank ('') or null field does not claim the medium", async () => {
      const env = {
        SMTP_HOST: 'env.example',
        SMTP_USER: 'eu',
        SMTP_PASSWORD: 'epw',
        SMTP_FROM: 'e@x.com',
      };
      const blank = settingsWith('email', { smtp: { port: '' } });
      const r = await resolverFor({ t1: blank }, env).resolve(CommunicationMedium.EMAIL, 't1');
      expect(r.config.host).toBe('env.example');

      const cleared = settingsWith('email', { smtp: { password: null } });
      const r2 = await resolverFor({ t1: cleared }, env).resolve(CommunicationMedium.EMAIL, 't1');
      expect(r2.source).toBe('platform');
      expect(r2.config.password).toBe('epw');
    });

    // Review round 2, item 12: a school that saved only its sender id owns the medium (same as
    // MiMSMS), so the platform key is never used under the school's name: the send fails closed.
    it('a school storing only onecodesoft.senderId fails closed, the platform key is not borrowed', async () => {
      const env = {
        ONECODESOFT_API_KEY: 'env-k',
        ONECODESOFT_API_URL: 'https://p.example/api',
      };
      const settings = settingsWith('sms', {
        provider: 'onecodesoft',
        metering: 'PLATFORM',
        onecodesoft: { senderId: 'SCHOOL' },
      });
      const err = await resolverFor({ t1: settings }, env, [new OnecodesoftProvider()])
        .resolve(CommunicationMedium.SMS, 't1')
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
      expect(err.message).toMatch(/never falls back to the platform account/);
      expect(err.message).not.toContain('env-k');
    });

    // #3331: a field the form cleared is sent as null. It is unset: never the stored value, never env.
    it('an override null on an optional field resolves without it (tenant-owned medium)', async () => {
      const settings = settingsWith('sms', {
        provider: 'mimsms',
        mimsms: { apiKey: 'tk', senderId: 'OLD', apiUrl: 'https://m.example/api' },
      });
      const r = await resolverFor(
        { t1: settings },
        { MIMSMS_API_URL: 'https://env.example' },
      ).resolve(CommunicationMedium.SMS, 't1', {
        override: { provider: 'mimsms', mimsms: { senderId: 'OLD', apiUrl: null } },
      });
      expect(r.config).toEqual({ apiKey: 'tk', senderId: 'OLD' });
      expect(r.source).toBe('tenant');
    });

    it('an override null on a non-owned optional field neither keeps the stored value nor uses env', async () => {
      const settings = settingsWith('whatsapp', {
        'meta-cloud': { phoneNumberId: '1', accessToken: 'tk', apiVersion: 'v99.0' },
      });
      const r = await resolverFor({ t1: settings }, { WHATSAPP_API_VERSION: 'v1.0' }).resolve(
        CommunicationMedium.WHATSAPP,
        't1',
        { override: { 'meta-cloud': { phoneNumberId: '1', apiVersion: null } } },
      );
      expect(r.config).toEqual({ phoneNumberId: '1', accessToken: 'tk' });
    });

    // #3338: a PLATFORM school that removed its own key is back on the platform account, and the
    // platform's SMS_PROVIDER (not the stale stored company) picks the company.
    describe('a PLATFORM school that owns nothing', () => {
      const env = {
        SMS_PROVIDER: 'mimsms',
        MIMSMS_API_KEY: 'env-k',
        MIMSMS_SENDER_ID: 'PLATFORM-ID',
      };

      it('a stored company with only nulls left sends on the platform company', async () => {
        const settings = settingsWith('sms', {
          provider: 'greenweb',
          metering: 'PLATFORM',
          greenweb: { apiKey: null, apiUrl: null },
        });
        const r = await resolverFor({ t1: settings }, env).resolve(CommunicationMedium.SMS, 't1');
        expect(r.provider.descriptor.name).toBe('mimsms');
        expect(r.config).toEqual({ apiKey: 'env-k', senderId: 'PLATFORM-ID' });
        expect(r.source).toBe('platform');
      });

      it('an empty stored company block also yields to SMS_PROVIDER', async () => {
        const settings = settingsWith('sms', {
          provider: 'greenweb',
          metering: 'PLATFORM',
          greenweb: {},
        });
        const r = await resolverFor({ t1: settings }, env).resolve(CommunicationMedium.SMS, 't1');
        expect(r.provider.descriptor.name).toBe('mimsms');
      });

      it("a caller's override provider still comes first", async () => {
        const settings = settingsWith('sms', { provider: 'greenweb', metering: 'PLATFORM' });
        const r = await resolverFor(
          { t1: settings },
          { ...env, GREENWEB_API_KEY: 'g-env' },
        ).resolve(CommunicationMedium.SMS, 't1', { override: { provider: 'greenweb' } });
        expect(r.provider.descriptor.name).toBe('greenweb');
        expect(r.config.apiKey).toBe('g-env');
      });

      // Review round 1 on #3347: only the stored company's OWN block decides. A draft for another
      // company does not keep a stale `greenweb`, and when the platform's SMS_PROVIDER picks that
      // other company, the school's draft for it is not used either (a partial draft would fail
      // closed, a full one would send on the school's keys while on platform credit).
      const platformCompany = async (sms: Record<string, unknown>) => {
        const r = await resolverFor(
          { t1: settingsWith('sms', sms) },
          { ...env, GREENWEB_API_KEY: 'g-env' },
        ).resolve(CommunicationMedium.SMS, 't1');
        expect(r.provider.descriptor.name).toBe('mimsms');
        expect(r.config).toEqual({ apiKey: 'env-k', senderId: 'PLATFORM-ID' });
        expect(r.source).toBe('platform');
      };

      it('a draft of another company (before the #3339 migration): platform company and keys', async () => {
        await platformCompany({
          provider: 'greenweb',
          metering: 'PLATFORM',
          greenweb: {},
          mimsms: { senderId: 'DRAFT' },
        });
      });

      it('a draft of another company (after the #3339 migration): platform company and keys', async () => {
        await platformCompany({ metering: 'PLATFORM', mimsms: { senderId: 'DRAFT' } });
      });

      it('a full draft of the platform company: platform company and keys', async () => {
        await platformCompany({
          provider: 'greenweb',
          metering: 'PLATFORM',
          greenweb: {},
          mimsms: { apiKey: 'school-k', senderId: 'DRAFT' },
        });
      });

      // #3350: Check status of a message sent on the platform account asks the platform account,
      // even when the school saved a full draft for that company (the send ignored that draft).
      it('platformProvider: resolves that company on the platform keys, never the school draft', async () => {
        const settings = settingsWith('sms', {
          metering: 'PLATFORM',
          mimsms: { apiKey: 'school-k', senderId: 'DRAFT' },
        });
        const r = await resolverFor({ t1: settings }, env).resolve(CommunicationMedium.SMS, 't1', {
          platformProvider: 'mimsms',
        });
        expect(r.provider.descriptor.name).toBe('mimsms');
        expect(r.config).toEqual({ apiKey: 'env-k', senderId: 'PLATFORM-ID' });
        expect(r.source).toBe('platform');
      });

      it('platformProvider: a company the platform has no keys for fails closed', async () => {
        const settings = settingsWith('sms', {
          metering: 'PLATFORM',
          greenweb: { apiKey: 'school-g' },
        });
        await expect(
          resolverFor({ t1: settings }, env).resolve(CommunicationMedium.SMS, 't1', {
            platformProvider: 'greenweb',
          }),
        ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
      });

      it("an override naming the draft's company still reads the school's saved draft", async () => {
        const settings = settingsWith('sms', {
          provider: 'greenweb',
          metering: 'PLATFORM',
          greenweb: {},
          mimsms: { apiKey: 'school-k', senderId: 'DRAFT' },
        });
        const r = await resolverFor({ t1: settings }, env).resolve(CommunicationMedium.SMS, 't1', {
          override: { provider: 'mimsms' },
        });
        expect(r.config).toEqual({ apiKey: 'school-k', senderId: 'DRAFT' });
        expect(r.source).toBe('tenant');
      });

      it('a stored company that owns its own block keeps it on platform credit', async () => {
        const settings = settingsWith('sms', {
          provider: 'greenweb',
          metering: 'PLATFORM',
          greenweb: { apiKey: 'school-g' },
          mimsms: { senderId: 'DRAFT' },
        });
        const r = await resolverFor({ t1: settings }, env).resolve(CommunicationMedium.SMS, 't1');
        expect(r.provider.descriptor.name).toBe('greenweb');
        expect(r.config.apiKey).toBe('school-g');
        expect(r.source).toBe('tenant');
      });

      it('a partly removed block (apiUrl still saved) still fails closed, the platform key is not borrowed', async () => {
        const settings = settingsWith('sms', {
          provider: 'greenweb',
          metering: 'PLATFORM',
          greenweb: { apiKey: null, apiUrl: 'https://g.example/api' },
        });
        const err = await resolverFor({ t1: settings }, { GREENWEB_API_KEY: 'g-env' })
          .resolve(CommunicationMedium.SMS, 't1')
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/never falls back to the platform account/);
      });

      it('not PLATFORM-metered: the stored company is kept and nothing reaches the platform keys', async () => {
        const settings = settingsWith('sms', { provider: 'greenweb', greenweb: {} });
        const err = await resolverFor({ t1: settings }, env)
          .resolve(CommunicationMedium.SMS, 't1')
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).not.toContain('env-k');
      });
    });

    // PR #3325 review, finding 1: an override that sets an owned field on a school with no config of
    // its own must not mix caller-chosen values (from, senderId, apiKey) with the platform's keys.
    describe('override sets an owned field on the platform tier', () => {
      const smtpEnv = {
        SMTP_HOST: 'env.example',
        SMTP_USER: 'eu',
        SMTP_PASSWORD: 'epw',
        SMTP_FROM: 'e@x.com',
      };

      it('an override `from` alone never sends through the platform SMTP login', async () => {
        const err = await resolverFor({}, smtpEnv)
          .resolve(CommunicationMedium.EMAIL, 't1', {
            override: { smtp: { from: 'ceo@bank.example' } },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/must carry .* themselves/);
        expect(err.message).not.toMatch(/epw|env\.example|ceo@bank/);
      });

      it('an override senderId alone never borrows the platform API key (PLATFORM-metered)', async () => {
        const settings = settingsWith('sms', { provider: 'mimsms', metering: 'PLATFORM' });
        const err = await resolverFor(
          { t1: settings },
          { MIMSMS_API_KEY: 'env-k', MIMSMS_SENDER_ID: 'PLATFORM-ID' },
        )
          .resolve(CommunicationMedium.SMS, 't1', {
            override: { provider: 'mimsms', mimsms: { senderId: 'ANYBANK' } },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/must carry .* themselves/);
      });

      it('a complete override resolves from the override alone and says so (source: override)', async () => {
        const settings = settingsWith('sms', { provider: 'mimsms', metering: 'PLATFORM' });
        const r = await resolverFor(
          { t1: settings },
          { MIMSMS_API_KEY: 'env-k', MIMSMS_SENDER_ID: 'PLATFORM-ID' },
        ).resolve(CommunicationMedium.SMS, 't1', {
          override: { provider: 'mimsms', mimsms: { apiKey: 'own-k', senderId: 'OWN' } },
        });
        expect(r.config).toEqual({ apiKey: 'own-k', senderId: 'OWN' });
        expect(r.source).toBe('override');
      });

      it('an override of only non-owned fields still uses the platform keys (source: platform)', async () => {
        const r = await resolverFor({}, smtpEnv).resolve(CommunicationMedium.EMAIL, 't1', {
          override: { smtp: {} },
        });
        expect(r.config).toEqual({
          host: 'env.example',
          user: 'eu',
          password: 'epw',
          from: 'e@x.com',
        });
        expect(r.source).toBe('platform');
      });

      // Deliberately not applied to the tenant tier: the settings form always sends the non-secret
      // owned fields and leaves out unchanged secrets, so "test my saved config" must keep working.
      // Mixing an override with the school's OWN stored login borrows nothing from the platform.
      it("tenant tier: an override `from` still resolves with the school's stored login (source: tenant)", async () => {
        const stored = settingsWith('email', {
          smtp: { host: 'smtp.example', user: 'u', password: 'pw', from: 'a@x.com' },
        });
        const r = await resolverFor({ t1: stored }, smtpEnv).resolve(
          CommunicationMedium.EMAIL,
          't1',
          {
            override: { smtp: { from: 'b@x.com' } },
          },
        );
        expect(r.config).toEqual({
          host: 'smtp.example',
          user: 'u',
          password: 'pw',
          from: 'b@x.com',
        });
        expect(r.source).toBe('tenant');
      });
    });

    // PR #3325 review round 2, finding 1: the settings form pre-fills the saved destination (SMTP
    // host + port, OneCodeSoft apiUrl) and leaves out an unchanged secret. The same destination is
    // the stored one, not a caller-chosen target, so the stored secret is used. A different
    // destination still needs every field itself: stored secrets never go to another host.
    describe('override repeats the stored destination', () => {
      const storedSmtp = settingsWith('email', {
        smtp: { host: 'smtp.example', port: 587, user: 'u', password: 'pw', from: 'a@x.com' },
      });
      const storedOcs = settingsWith('sms', {
        provider: 'onecodesoft',
        onecodesoft: { apiKey: 'stored-k', apiUrl: 'https://sms.example.com/api' },
      });
      const ocs = (t: TenantSettings) => resolverFor({ t1: t }, {}, [new OnecodesoftProvider()]);

      it('SMTP: the same host + port (the form payload) uses the stored password', async () => {
        const r = await resolverFor({ t1: storedSmtp }).resolve(CommunicationMedium.EMAIL, 't1', {
          override: { smtp: { host: 'smtp.example', port: 587, user: 'u', from: 'a@x.com' } },
        });
        expect(r.config).toEqual({
          host: 'smtp.example',
          port: '587',
          user: 'u',
          password: 'pw',
          from: 'a@x.com',
        });
        expect(r.source).toBe('tenant');
      });

      it('SMTP: a different host is still refused, the stored password is not borrowed', async () => {
        const err = await resolverFor({ t1: storedSmtp })
          .resolve(CommunicationMedium.EMAIL, 't1', {
            override: { smtp: { host: 'other.example', port: 587, user: 'u', from: 'a@x.com' } },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/Testing a new destination requires .* \(missing: password\)/);
      });

      it('SMTP: the same host on a different port is still a new destination', async () => {
        const err = await resolverFor({ t1: storedSmtp })
          .resolve(CommunicationMedium.EMAIL, 't1', {
            override: { smtp: { host: 'smtp.example', port: '25', user: 'u', from: 'a@x.com' } },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/Testing a new destination requires/);
      });

      it('OneCodeSoft: the same apiUrl uses the stored API key', async () => {
        const r = await ocs(storedOcs).resolve(CommunicationMedium.SMS, 't1', {
          override: {
            provider: 'onecodesoft',
            onecodesoft: { apiUrl: 'https://sms.example.com/api' },
          },
        });
        expect(r.config).toEqual({ apiKey: 'stored-k', apiUrl: 'https://sms.example.com/api' });
        expect(r.source).toBe('tenant');
      });

      it('OneCodeSoft: a different apiUrl is still refused, the stored key is not borrowed', async () => {
        const err = await ocs(storedOcs)
          .resolve(CommunicationMedium.SMS, 't1', {
            override: {
              provider: 'onecodesoft',
              onecodesoft: { apiUrl: 'https://evil.example/api' },
            },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).toMatch(/Testing a new destination requires .* \(missing: apiKey\)/);
        expect(err.message).not.toContain('stored-k');
      });

      it('a destination matching the platform env (school owns nothing) never borrows the platform key', async () => {
        const settings = settingsWith('sms', { provider: 'onecodesoft', metering: 'PLATFORM' });
        const err = await resolverFor(
          { t1: settings },
          { ONECODESOFT_API_KEY: 'env-k', ONECODESOFT_API_URL: 'https://p.example/api' },
          [new OnecodesoftProvider()],
        )
          .resolve(CommunicationMedium.SMS, 't1', {
            override: { onecodesoft: { apiUrl: 'https://p.example/api' } },
          })
          .catch((e) => e);
        expect(err).toBeInstanceOf(ProviderNotConfiguredError);
        expect(err.message).not.toContain('env-k');
      });
    });

    it('ignores non-string override values and unknown keys', async () => {
      const err = await resolverFor({})
        .resolve(CommunicationMedium.MESSENGER, 't1', {
          override: { pageId: { $ne: 1 }, accessToken: ['x'], bogus: 'y' },
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderNotConfiguredError);
    });
  });
});
