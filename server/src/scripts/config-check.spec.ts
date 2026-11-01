import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'dotenv';
import {
  COMMON_REQUIRED,
  loadEnvFile,
  runConfigCheck,
  runProductionConfigCheck,
  runStackConfigCheck,
  TURNSTILE_TEST_SECRET,
  TURNSTILE_TEST_SITE_KEY,
} from './config-check';
import { hashPassword } from '../modules/auth/password-hash';

const repoRoot = join(__dirname, '..', '..', '..');

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://app:Zq8vR2mXw4Lp@db:5432/biddaloy',
  JWT_SECRET: 'k9Zr2Qv7Lm4Xw8Tb3Nc6Hy1Pd5Sf0Ja2Ug',
  // base64 of 32 bytes, as `randomBytes(32).toString('base64')` prints
  SETTINGS_ENCRYPTION_KEY: 'Fh3Jd9Kc2Vb7Nx5Mz1Qw8Er4Ty6Ui0OpLk3AseRt7Yu=',
  DB_SSL: 'true',
  APP_BASE_URL: 'https://app.school.org',
  PUBLIC_APP_URL: 'https://app.school.org',
};

describe('runConfigCheck', () => {
  it('passes a valid production env', () => {
    expect(runConfigCheck(valid)).toEqual({ ok: true, output: 'config ok' });
  });

  it('fails a placeholder env, naming the variable but not its value', () => {
    const secret = 'replace-me-replace-me-replace-me-123';
    const result = runConfigCheck({ ...valid, JWT_SECRET: secret });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('JWT_SECRET');
    expect(result.output).not.toContain(secret);
  });

  it('the CLI judges production even when NODE_ENV is development or unset', () => {
    const bad = { ...valid, JWT_SECRET: 'replace-me-replace-me-replace-me-123' };
    expect(runConfigCheck({ ...bad, NODE_ENV: 'development' }).ok).toBe(true); // rules skipped
    expect(runProductionConfigCheck({ ...bad, NODE_ENV: 'development' }).ok).toBe(false);
    const { NODE_ENV: _omit, ...unset } = bad;
    expect(runProductionConfigCheck(unset).ok).toBe(false);
  });

  it('fails POSTGRES_PASSWORD=change-me (compose builds the container DATABASE_URL from it)', () => {
    const result = runConfigCheck({ ...valid, POSTGRES_PASSWORD: 'change-me' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('POSTGRES_PASSWORD');
  });

  it('runs the boot checks outside env.validation and lists every failure', () => {
    const result = runConfigCheck({
      ...valid,
      DB_SSL: undefined,
      SETTINGS_ENCRYPTION_KEY: 'c2hvcnQta2V5LW9ubHktMTYtYnl0ZXM=',
      PUBLIC_APP_URL: 'http://app.school.org',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('DB_SSL must be "true"');
    expect(result.output).toContain('SETTINGS_ENCRYPTION_KEY must be base64 for exactly 32 bytes');
    expect(result.output).toContain('PUBLIC_APP_URL must be an HTTPS URL');
    expect(result.output).not.toContain('c2hvcnQta2V5');
  });

  it('fails when the secret-echo flag is on in production', () => {
    const result = runConfigCheck({ ...valid, ACCOUNT_ACCESS_ECHO_SECRETS: 'true' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('ACCOUNT_ACCESS_ECHO_SECRETS');
  });

  it('fails ENABLE_API_DOCS=true without both docs credentials, as boot does', () => {
    const docs = { ...valid, ENABLE_API_DOCS: 'true', API_DOCS_USER: 'docs' };
    const result = runConfigCheck(docs);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('API_DOCS_PASSWORD');
    expect(runConfigCheck({ ...docs, API_DOCS_PASSWORD: 'Zq8vR2mXw4Lp' }).ok).toBe(true);
  });
});

describe('runStackConfigCheck', () => {
  // The .env exactly as an operator writes it: infra/secrets/<stack>.example.env with its keys
  // filled in. Not `...valid`: that already holds DATABASE_URL, which compose (not the .env)
  // builds, and hid that gap once.
  const fill: Record<string, string> = {
    APP_VERSION: '0'.repeat(40),
    APP_BASE_URL: 'https://school.example.org',
    PUBLIC_APP_URL: 'https://school.example.org',
    CORS_ORIGINS: 'https://school.example.org',
    POSTGRES_USER: 'app',
    POSTGRES_PASSWORD: 'Zq8vR2mXw4Lp',
    JWT_SECRET: valid.JWT_SECRET,
    SETTINGS_ENCRYPTION_KEY: valid.SETTINGS_ENCRYPTION_KEY,
    HEALTH_TOKEN: 'h7Kp2Vx9Qm4Lr8Tz',
    S3_ACCESS_KEY_ID: 'k9Zr2Qv7',
    S3_SECRET_ACCESS_KEY: 'Lm4Xw8Tb3Nc6Hy1Pd5Sf',
    BACKUP_AGE_PUBLIC_KEY: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    STAGING_PASSWORD: 'Stage-Pass-2026',
    // base64 of a real bcrypt cost-12 hash of 'Stage-Pass-2026' (config:check verifies the pair)
    STAGING_PASSWORD_HASH_B64:
      'JDJiJDEyJERlS1E4enBkYkxRSk1JV21NbkJBdS44NXZaVGxrcGp1b3lKdUlyMjQ4dUs4RjVRL1ZhTVd1',
    PLATFORM_TENANT_ID: '00000000-0000-4000-8000-000000000001',
    SMOKE_SCHOOL_SLUG: 'smoke-school',
    BACKUP_S3_ENDPOINT: 'https://r2.example.org',
    BACKUP_S3_BUCKET: 'biddaloy-backups',
    BACKUP_S3_ACCESS_KEY_ID: 'r2-read-only',
    BACKUP_S3_SECRET_ACCESS_KEY: 'r2-read-only-secret',
    DEMO_PASSWORD: 'Demo-Public-2026',
    // the bucket and database name differ per stack
    S3_BUCKET: 'biddaloy-STACK',
    POSTGRES_DB: 'biddaloy_STACK',
    // deploy/stack.yml passes an unset rate as "", which env.validation rejects: always fill it
    SENTRY_TRACES_SAMPLE_RATE: '0.1',
    // a stack that holds a Turnstile pair in its example keeps it; prod gets a matching pair
    TURNSTILE_SITE_KEY: '0x4AAAAAAAsite',
    TURNSTILE_SECRET_KEY: '0x4AAAAAAAsecret',
    // keys the example leaves empty on staging/demo on purpose stay empty
  };
  const emptyOnPurpose = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'FACEBOOK_OAUTH_CLIENT_ID',
    'FACEBOOK_OAUTH_CLIENT_SECRET',
    'SMS_PROVIDER',
    'GREENWEB_API_KEY',
    'GREENWEB_API_URL',
    'MIMSMS_API_KEY',
    'MIMSMS_SENDER_ID',
    'MIMSMS_API_URL',
    'ONECODESOFT_API_KEY',
    'ONECODESOFT_SENDER_ID',
    'ONECODESOFT_API_URL',
    'PLATFORM_SMS_PROVIDER',
    'PLATFORM_SMS_API_KEY',
    'PLATFORM_SMS_SENDER_ID',
    'PLATFORM_SMS_API_URL',
    'PLATFORM_ALERT_PHONES',
  ];

  /** The example file with every empty key filled; non-empty example values stay as written. */
  function filled(stack: 'prod' | 'staging' | 'demo'): Record<string, string> {
    const example = parse(readFileSync(join(repoRoot, `infra/secrets/${stack}.example.env`)));
    return Object.fromEntries(
      Object.entries(example).map(([k, v]) => {
        if (v !== '' || emptyOnPurpose.includes(k)) return [k, v];
        const dummy = (fill[k] ?? '').replace('STACK', stack);
        return [k, dummy];
      }),
    );
  }
  const prod = { ...filled('prod'), S3_BUCKET: 'biddaloy', POSTGRES_DB: 'biddaloy' };
  const staging = filled('staging');
  const demo = filled('demo');

  it('each example file with dummy values passes its own --env', async () => {
    expect(await runStackConfigCheck('prod', prod)).toEqual({ ok: true, output: 'config ok' });
    expect(await runStackConfigCheck('staging', staging)).toEqual({
      ok: true,
      output: 'config ok',
    });
    expect(await runStackConfigCheck('demo', demo)).toEqual({ ok: true, output: 'config ok' });
  });

  it('the old STAGING_REFRESH_PUSH_URL name still passes, with a rename warning (88 U3)', async () => {
    const old = await runStackConfigCheck('staging', {
      ...staging,
      STAGING_REFRESH_PUSH_URL: 'https://kuma.example.org/api/push/t',
    });
    expect(old.ok).toBe(true);
    expect(old.output).toContain('RESTORE_DRILL_PUSH_URL');
    const renamed = await runStackConfigCheck('staging', {
      ...staging,
      RESTORE_DRILL_PUSH_URL: 'https://kuma.example.org/api/push/t',
    });
    expect(renamed).toEqual({ ok: true, output: 'config ok' });
  });

  it('MESSAGE_SINK pairing errors (87 D3, D10, D22)', async () => {
    const out = async (stack: 'prod' | 'staging' | 'demo', env: Record<string, string>) =>
      (await runStackConfigCheck(stack, env)).output;
    const onProd = await out('prod', { ...prod, MESSAGE_SINK: 'mailpit' });
    expect(onProd).toContain('MESSAGE_SINK must not be mailpit on prod');
    for (const [stack, file] of [
      ['staging', staging],
      ['demo', demo],
    ] as const) {
      const bad = await out(stack, { ...file, MESSAGE_SINK: '', MESSAGE_SINK_PUBLIC_URL: '' });
      expect(bad).toContain(`MESSAGE_SINK must be mailpit on ${stack}`);
      expect(bad).toContain(`MESSAGE_SINK_PUBLIC_URL must be set on ${stack}`);
      // each line appears once (stack check and runConfigCheck agree)
      expect(bad.split('\n').filter((l) => l.startsWith('MESSAGE_SINK must')).length).toBe(1);
      expect(await out(stack, { ...file, SMTP_HOST: 'smtp.real.example' })).toContain(
        `SMTP_HOST must be empty on ${stack}`,
      );
    }
    expect(await out('prod', prod)).not.toContain('MESSAGE_SINK');
  });

  // Without the `sink` profile a manual `up -d` (and the doctor) would miss mailpit; prod never
  // runs it.
  it('staging and demo need the sink profile; prod refuses it (87 F6)', async () => {
    for (const [stack, file] of [
      ['staging', staging],
      ['demo', demo],
    ] as const) {
      expect(file.COMPOSE_PROFILES).toBe('sink'); // the example sets it
      const { output } = await runStackConfigCheck(stack, { ...file, COMPOSE_PROFILES: '' });
      expect(output).toContain(`COMPOSE_PROFILES must contain sink on ${stack}`);
    }
    const onProd = await runStackConfigCheck('prod', {
      ...prod,
      COMPOSE_PROFILES: 'replica,backup,sink',
    });
    expect(onProd.output).toContain('COMPOSE_PROFILES must not contain sink on prod');
  });

  // Staging may choose real providers on purpose; demo and prod can never carry the flag.
  it('ALLOW_REAL_PROVIDERS_ON_STAGING frees staging from the inbox only', async () => {
    const real = {
      ...staging,
      ALLOW_REAL_PROVIDERS_ON_STAGING: 'true',
      MESSAGE_SINK: 'real',
      COMPOSE_PROFILES: '',
    };
    expect((await runStackConfigCheck('staging', real)).output).not.toContain('must be mailpit');
    expect((await runStackConfigCheck('staging', real)).output).not.toContain('must contain sink');
    const onDemo = await runStackConfigCheck('demo', {
      ...demo,
      ALLOW_REAL_PROVIDERS_ON_STAGING: 'true',
    });
    expect(onDemo.output).toContain('ALLOW_REAL_PROVIDERS_ON_STAGING must not be set on demo');
  });

  // The part of deploy/stack.yml that makes the app container: x-s3, x-db-url and x-app.
  const stackYml = readFileSync(join(repoRoot, 'deploy/stack.yml'), 'utf8');
  const appBlock = stackYml.slice(stackYml.indexOf('\nx-s3:'), stackYml.indexOf('\nx-jobs-env:'));

  it('COMMON_REQUIRED equals the `:?` variables of the app container (both ways)', async () => {
    const fromCompose = [...appBlock.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)]
      .map((m) => m[1])
      .filter((k) => k !== 'PG_TLS_DIR'); // a path the deploy sets, not in the .env
    expect([...new Set(fromCompose)].sort()).toEqual([...COMMON_REQUIRED].sort());
  });

  // [87 F2] The nightly demo rebuild (seed + temporary :3999 app) must send through the test inbox
  // too. Without ENV_NAME the boot guard never runs; without MESSAGE_SINK it uses real providers.
  it('demo-reset passes ENV_NAME and the sink keys, never MESSAGE_SINK_SMTP_URL', () => {
    const start = stackYml.indexOf('\n  demo-reset:');
    expect(start).toBeGreaterThan(0);
    const block = stackYml.slice(start, stackYml.indexOf('\n    volumes:', start));
    expect(block).toContain('ENV_NAME: ${ENV_NAME:?ENV_NAME must be set}');
    expect(block).toContain('MESSAGE_SINK: ${MESSAGE_SINK:-}');
    expect(block).toContain('MESSAGE_SINK_PUBLIC_URL: ${MESSAGE_SINK_PUBLIC_URL:-}');
    expect(block).not.toMatch(/^\s+MESSAGE_SINK_SMTP_URL:/m);
  });

  // What really keeps a provider key out of the staging app is that stack.yml passes an explicit
  // list. A new key there must be classified on purpose: listed here as not a provider, or
  // refused by the staging check when set.
  it('every key stack.yml passes to the app is a known non-provider or refused on staging', async () => {
    const env = appBlock.slice(appBlock.indexOf('  environment:'), appBlock.indexOf('  volumes:'));
    const keys = [...env.matchAll(/^ {4}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
    const s3 = appBlock.slice(appBlock.indexOf('x-s3:'), appBlock.indexOf('x-db-url:'));
    keys.push(...[...s3.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]));
    const notProvider = new Set([
      'NODE_ENV',
      'ENV_NAME',
      'ENV_BADGE',
      'ENV_BADGE_DATE',
      'MESSAGE_SINK',
      'MESSAGE_SINK_PUBLIC_URL',
      'MESSAGE_SINK_SMTP_URL', // fixed to this stack's mailpit by stack.yml, not an operator value
      'ALLOW_REAL_PROVIDERS_ON_STAGING',
      'DATABASE_URL',
      'NODE_EXTRA_CA_CERTS',
      'DB_SSL',
      'DB_SSL_REJECT_UNAUTHORIZED',
      'REDIS_URL',
      'JWT_SECRET',
      'JWT_SECRET_PREVIOUS',
      'CORS_ORIGINS',
      'S3_ENDPOINT',
      'S3_ALLOW_INSECURE_HTTP',
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_FORCE_PATH_STYLE',
      'APP_BASE_URL',
      'PUBLIC_APP_URL',
      'HEALTH_TOKEN',
      'SETTINGS_ENCRYPTION_KEY',
      'SETTINGS_ENCRYPTION_KEY_PREVIOUS',
      'PLATFORM_TENANT_ID',
      'TURNSTILE_SECRET_KEY',
      'TURNSTILE_SITE_KEY',
      'SENTRY_DSN_WEB',
      'SENTRY_ENVIRONMENT',
      'SENTRY_TRACES_SAMPLE_RATE',
      'SENTRY_RELEASE',
      'APP_VERSION',
      'SUPPORT_CONTACT_URL',
      'OTP_SMS_ALLOWED_PREFIXES',
      'DEMO_MODE',
      'DEMO_PASSWORD',
    ]);
    expect(keys.length).toBeGreaterThan(20);
    // No hash here: this loops over every key, and the hash check costs a bcrypt compare.
    const noHash = { ...staging, STAGING_PASSWORD_HASH_B64: '' };
    const unclassified: string[] = [];
    for (const k of keys.filter((key) => !notProvider.has(key))) {
      const { output } = await runStackConfigCheck('staging', { ...noHash, [k]: 'live-value-123' });
      if (!output.includes(`${k} must be empty on staging`)) unclassified.push(k);
    }
    expect(unclassified).toEqual([]);
  });

  it('staging refuses Google and Facebook sign-in credentials', async () => {
    for (const key of ['GOOGLE_OAUTH_CLIENT_ID', 'FACEBOOK_OAUTH_CLIENT_SECRET']) {
      const result = await runStackConfigCheck('staging', { ...staging, [key]: 'live-value-123' });
      expect(result.output).toContain(`${key} must be empty on staging`);
    }
  });

  it('prod refuses Cloudflare always-pass Turnstile test keys', async () => {
    for (const test of [
      { TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY, TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET },
      { TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY },
      { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET },
    ]) {
      const result = await runStackConfigCheck('prod', { ...prod, ...test });
      expect(result.ok).toBe(false);
      expect(result.output).toContain("TURNSTILE_* must not be Cloudflare's always-pass");
    }
  });

  it('staging needs the Cloudflare test Turnstile site key', async () => {
    const result = await runStackConfigCheck('staging', {
      ...staging,
      TURNSTILE_SITE_KEY: '0x4AAAreal',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('TURNSTILE_SITE_KEY');
    expect(result.output).not.toContain('0x4AAAreal');
  });

  it('non-prod refuses the backup and replica profiles', async () => {
    for (const [stack, env] of [
      ['staging', staging],
      ['demo', demo],
    ] as const) {
      for (const profile of ['backup', 'replica']) {
        const result = await runStackConfigCheck(stack, { ...env, COMPOSE_PROFILES: profile });
        expect(result.output, `${stack} ${profile}`).toContain(`must not contain ${profile}`);
      }
    }
    expect((await runStackConfigCheck('prod', prod)).ok).toBe(true); // prod keeps both
  });

  // `docker compose run jobs|demo-reset` turns the profile on by itself; set in the .env, `up -d`
  // would start the one-off runner too.
  it('every stack refuses the one-off runner profiles', async () => {
    for (const [stack, env] of [
      ['prod', prod],
      ['staging', staging],
      ['demo', demo],
    ] as const) {
      for (const profile of ['jobs', 'demo-jobs']) {
        const result = await runStackConfigCheck(stack, {
          ...env,
          COMPOSE_PROFILES: `replica,${profile}`,
        });
        expect(result.output, `${stack} ${profile}`).toContain(
          `COMPOSE_PROFILES must not contain ${profile}`,
        );
      }
    }
  });

  // Rule 9: the hash the refresh writes must be the hash of the password the smoke test uses.
  it('staging refuses a hash of another password, without printing either', async () => {
    const other = Buffer.from(await hashPassword('Another-Pass-2026')).toString('base64');
    const result = await runStackConfigCheck('staging', {
      ...staging,
      STAGING_PASSWORD_HASH_B64: other,
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain(
      'STAGING_PASSWORD_HASH_B64 is not the hash of STAGING_PASSWORD',
    );
    expect(result.output).not.toContain(other);
    expect(result.output).not.toContain('Stage-Pass-2026');
  });

  it('staging refuses a raw (not base64) or non-bcrypt hash', async () => {
    const raw = Buffer.from(staging.STAGING_PASSWORD_HASH_B64, 'base64').toString();
    const cost10 = Buffer.from(raw.replace('$12$', '$10$')).toString('base64');
    for (const bad of [raw, cost10, 'bm90LWEtaGFzaA==']) {
      const result = await runStackConfigCheck('staging', {
        ...staging,
        STAGING_PASSWORD_HASH_B64: bad,
      });
      expect(result.output).toContain('base64 of a bcrypt cost-12 hash');
    }
  });

  it('staging checks the shapes the nightly refresh checks', async () => {
    const result = await runStackConfigCheck('staging', {
      ...staging,
      PLATFORM_TENANT_ID: 'platform',
      SMOKE_SCHOOL_SLUG: 'Smoke School',
      BACKUP_S3_ENDPOINT: 'http://r2.example.org',
    });
    expect(result.output).toContain('PLATFORM_TENANT_ID must be a uuid');
    expect(result.output).toContain('SMOKE_SCHOOL_SLUG must be lowercase');
    expect(result.output).toContain('BACKUP_S3_ENDPOINT must start with https://');
  });

  // Staging reads db/ dumps only; the crypt key would decrypt every prod file (photos, documents).
  it("staging refuses prod's rclone crypt password and salt", async () => {
    for (const key of ['BACKUP_RCLONE_CRYPT_PASSWORD', 'BACKUP_RCLONE_CRYPT_SALT']) {
      const result = await runStackConfigCheck('staging', { ...staging, [key]: 'crypt-value-123' });
      expect(result.output).toContain(`${key} must be empty on staging`);
      expect(result.output).not.toContain('crypt-value-123');
    }
  });

  it('demo refuses an offsite backup target', async () => {
    const result = await runStackConfigCheck('demo', { ...demo, BACKUP_S3_BUCKET: 'prod-backups' });
    expect(result.output).toContain('BACKUP_S3_BUCKET must be empty on demo');
  });

  it('SENTRY_TRACES_SAMPLE_RATE defaults to 0.1 as in stack.yml; an invalid value fails', async () => {
    expect((await runStackConfigCheck('prod', { ...prod, SENTRY_TRACES_SAMPLE_RATE: '' })).ok).toBe(
      true,
    );
    const bad = await runStackConfigCheck('prod', { ...prod, SENTRY_TRACES_SAMPLE_RATE: '5' });
    expect(bad.ok).toBe(false);
    expect(bad.output).toContain('SENTRY_TRACES_SAMPLE_RATE');
  });

  it('a DATABASE_URL in the host file cannot override the one compose builds', async () => {
    const result = await runStackConfigCheck('prod', { ...prod, DATABASE_URL: 'not-a-url' });
    expect(result.ok).toBe(true);
  });

  it('fails when a required variable is missing, per stack', async () => {
    for (const [stack, env, key] of [
      ['prod', prod, 'BACKUP_AGE_PUBLIC_KEY'],
      ['staging', staging, 'STAGING_PASSWORD'],
      // what the nightly refresh refuses to run without
      ['staging', staging, 'STAGING_PASSWORD_HASH_B64'],
      ['staging', staging, 'PLATFORM_TENANT_ID'],
      ['staging', staging, 'SMOKE_SCHOOL_SLUG'],
      ['staging', staging, 'BACKUP_S3_BUCKET'],
      ['demo', demo, 'DEMO_PASSWORD'],
      ['prod', prod, 'POSTGRES_PASSWORD'],
    ] as const) {
      const result = await runStackConfigCheck(stack, { ...env, [key]: '' });
      expect(result.ok, `${stack} ${key}`).toBe(false);
      expect(result.output).toContain(key);
    }
  });

  it('fails an env file made for another stack', async () => {
    const result = await runStackConfigCheck('prod', staging);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('ENV_NAME must be prod');
  });

  it('staging with DEMO_MODE=true fails', async () => {
    const result = await runStackConfigCheck('staging', { ...staging, DEMO_MODE: 'true' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('DEMO_MODE must be false on staging');
  });

  it('staging with a short STAGING_PASSWORD fails, without printing it', async () => {
    const result = await runStackConfigCheck('staging', {
      ...staging,
      STAGING_PASSWORD: 'short-pw-11',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('STAGING_PASSWORD');
    expect(result.output).not.toContain('short-pw-11');
  });

  it('staging pointing at a prod bucket or prod database name fails', async () => {
    const result = await runStackConfigCheck('staging', {
      ...staging,
      S3_BUCKET: 'biddaloy',
      POSTGRES_DB: 'biddaloy',
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain('S3_BUCKET');
    expect(result.output).toContain('POSTGRES_DB');
  });

  it('staging with a real Turnstile secret fails, without printing it', async () => {
    const result = await runStackConfigCheck('staging', {
      ...staging,
      TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal',
    });
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain('0x4AAAAAAAreal');
  });

  it('staging with a provider variable set fails, naming it but not its value', async () => {
    for (const key of [
      'PLATFORM_SMS_API_KEY',
      'SMS_PROVIDER',
      'ONECODESOFT_API_KEY',
      'ONECODESOFT_API_URL',
      'SMTP_HOST',
      'PLATFORM_ALERT_PHONES',
    ]) {
      const result = await runStackConfigCheck('staging', { ...staging, [key]: 'live-value-123' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain(key);
      expect(result.output).not.toContain('live-value-123');
    }
    expect((await runStackConfigCheck('staging', { ...staging, SMTP_HOST: '' })).ok).toBe(true);
  });

  describe('platform SMS provider (97 D3)', () => {
    const onecode = {
      SMS_PROVIDER: 'onecodesoft',
      ONECODESOFT_API_KEY: 'k-123',
      ONECODESOFT_SENDER_ID: 'sid',
      ONECODESOFT_API_URL: 'https://gw.example/api',
    };

    it('prod passes with SMS_PROVIDER=onecodesoft and its three keys', async () => {
      expect(await runStackConfigCheck('prod', { ...prod, ...onecode })).toEqual({
        ok: true,
        output: 'config ok',
      });
    });

    it('prod refuses an unknown SMS_PROVIDER without echoing it', async () => {
      const r = await runStackConfigCheck('prod', {
        ...prod,
        ...onecode,
        SMS_PROVIDER: 'nosuchvendor',
      });
      expect(r.ok).toBe(false);
      expect(r.output).toContain('SMS_PROVIDER must name a registered SMS provider');
      expect(r.output).not.toContain('nosuchvendor');
    });

    it('prod refuses a chosen provider missing a required key, naming keys only', async () => {
      const { ONECODESOFT_API_URL: _u, ...noUrl } = onecode;
      const r = await runStackConfigCheck('prod', { ...prod, ...noUrl });
      expect(r.ok).toBe(false);
      expect(r.output).toContain('ONECODESOFT_API_URL');
      expect(r.output).not.toContain('k-123');
      const m = await runStackConfigCheck('prod', {
        ...prod,
        SMS_PROVIDER: 'mimsms',
        MIMSMS_API_KEY: 'k-123',
      });
      expect(m.ok).toBe(false);
      expect(m.output).toContain('MIMSMS_SENDER_ID');
    });

    // CodeRabbit on PR #3325: a key of spaces only is not a key.
    it('prod refuses a required key that is only spaces', async () => {
      const r = await runStackConfigCheck('prod', {
        ...prod,
        ...onecode,
        ONECODESOFT_API_KEY: '   ',
      });
      expect(r.ok).toBe(false);
      expect(r.output).toContain('SMS_PROVIDER needs ONECODESOFT_API_KEY on prod');
    });

    it('prod refuses provider keys with no SMS_PROVIDER', async () => {
      const r = await runStackConfigCheck('prod', { ...prod, ...onecode, SMS_PROVIDER: '' });
      expect(r.ok).toBe(false);
      expect(r.output).toContain('SMS_PROVIDER must name a registered SMS provider');
    });

    it('prod with only SMTP keys and no SMS_PROVIDER passes', async () => {
      const r = await runStackConfigCheck('prod', { ...prod, SMTP_HOST: 'smtp.example.com' });
      expect(r.ok).toBe(true);
      expect(r.output).not.toContain('SMS_PROVIDER');
    });

    it('prod refuses a typo SMS_PROVIDER even with no SMS keys, without echoing it', async () => {
      const r = await runStackConfigCheck('prod', { ...prod, SMS_PROVIDER: 'onecodesft' });
      expect(r.ok).toBe(false);
      expect(r.output).toContain('SMS_PROVIDER must name a registered SMS provider');
      expect(r.output).not.toContain('onecodesft');
    });

    it('prod with no provider keys at all is fine (alerts then only warn)', async () => {
      expect((await runStackConfigCheck('prod', prod)).ok).toBe(true);
    });

    it('staging and demo refuse ONECODESOFT_API_KEY by name', async () => {
      for (const [stack, env] of [
        ['staging', staging],
        ['demo', demo],
      ] as const) {
        const r = await runStackConfigCheck(stack, { ...env, ONECODESOFT_API_KEY: 'live-123' });
        expect(r.output).toContain('ONECODESOFT_API_KEY must be empty');
        expect(r.output).not.toContain('live-123');
      }
    });
  });

  it('demo with a bucket other than biddaloy-demo fails', async () => {
    for (const bucket of ['biddaloy', 'prod-demo-copy']) {
      const result = await runStackConfigCheck('demo', { ...demo, S3_BUCKET: bucket });
      expect(result.ok).toBe(false);
      expect(result.output).toContain('S3_BUCKET must be biddaloy-demo');
    }
  });

  it('demo needs DEMO_MODE=true; prod refuses it', async () => {
    expect((await runStackConfigCheck('demo', { ...demo, DEMO_MODE: 'false' })).ok).toBe(false);
    expect((await runStackConfigCheck('prod', { ...prod, DEMO_MODE: 'true' })).ok).toBe(false);
  });

  it('one Turnstile key alone fails, on every stack', async () => {
    for (const [stack, env] of [
      ['prod', prod],
      ['staging', staging],
      ['demo', demo],
    ] as const) {
      const siteOnly = await runStackConfigCheck(stack, { ...env, TURNSTILE_SECRET_KEY: '' });
      const secretOnly = await runStackConfigCheck(stack, { ...env, TURNSTILE_SITE_KEY: '' });
      expect(siteOnly.output, stack).toContain('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY');
      expect(secretOnly.output, stack).toContain('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY');
    }
  });

  it('--file reads only the file, never the calling shell env', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cc-')), 'env');
    writeFileSync(file, 'S3_BUCKET=biddaloy-staging\n');
    const env = loadEnvFile(file, { SMTP_HOST: 'from-shell' });
    expect(env).toEqual({ S3_BUCKET: 'biddaloy-staging' });
    expect(loadEnvFile(undefined, { SMTP_HOST: 'x' })).toEqual({ SMTP_HOST: 'x' });
  });

  it('still runs the production checks', async () => {
    const bad = { ...staging, JWT_SECRET: 'replace-me-replace-me-replace-me-123' };
    expect((await runStackConfigCheck('staging', bad)).ok).toBe(false);
  });
});
