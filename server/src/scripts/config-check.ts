import 'reflect-metadata';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config, parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { assertMessageSinkAllowed, validate } from '../config/env.validation';
import { assertSecretEchoAllowed } from '../modules/account-access/account-access-echo';
import { buildDatabaseSsl } from '../db-ssl';
import {
  buildEncryptionKey,
  buildPreviousEncryptionKeys,
} from '../modules/schools/settings/encryption-key';
import { resolveAppBaseUrl } from '../modules/account-access/app-base-url.util';
import { resolvePublicAppUrl } from '../modules/invoices/public-app-url.util';
import { requireDocsCredentials } from '../swagger';
import { verifyPassword } from '../modules/auth/password-hash';
import { CommunicationMedium } from '@biddaloy/shared';
import { MESSAGING_PROVIDERS } from '../modules/communications/providers/messaging-providers';
import { envName } from '../modules/communications/config/messaging-config.resolver';

/**
 * `yarn config:check` — runs the boot-time config checks without starting
 * Nest: env.validation.ts, the ACCOUNT_ACCESS_ECHO_SECRETS guard (main.ts),
 * DB_SSL (db-ssl.ts), the SETTINGS_ENCRYPTION_KEY(_PREVIOUS) shape (encryption-key.ts),
 * the APP_BASE_URL / PUBLIC_APP_URL https checks the link builders run, and
 * the ENABLE_API_DOCS credentials check (main.ts).
 * `--env prod|staging|demo` adds that stack's rules (runStackConfigCheck): required vars, ENV_NAME,
 * no prod database or bucket outside prod, DEMO_MODE, the Turnstile key pair, no one-off runner
 * profile, the test inbox (MESSAGE_SINK and the `sink` profile on staging/demo, neither on prod),
 * and on staging what the nightly refresh needs. From the app image:
 * `node server/dist/scripts/config-check.js --env <e> --file /dev/stdin`.
 * Every failing check is listed. Error text names variables only, never
 * their values.
 */
export function runConfigCheck(env: Record<string, unknown>): { ok: boolean; output: string } {
  const get = (key: string) => env[key] as string | undefined;
  const config = { get } as unknown as ConfigService;
  const checks = [
    () => validate(env),
    () => assertSecretEchoAllowed(get('NODE_ENV'), get('ACCOUNT_ACCESS_ECHO_SECRETS')),
    () =>
      assertMessageSinkAllowed(
        get('ENV_NAME'),
        get('MESSAGE_SINK'),
        get('ALLOW_REAL_PROVIDERS_ON_STAGING'),
      ),
    () => buildDatabaseSsl(get('NODE_ENV'), get('DB_SSL'), get('DB_SSL_REJECT_UNAUTHORIZED')),
    // An unset key or URL is already reported by validate(); these add the shape checks.
    () =>
      get('SETTINGS_ENCRYPTION_KEY') &&
      buildEncryptionKey(get('NODE_ENV'), get('SETTINGS_ENCRYPTION_KEY')),
    () => buildPreviousEncryptionKeys(get('SETTINGS_ENCRYPTION_KEY_PREVIOUS')),
    () => get('APP_BASE_URL') && resolveAppBaseUrl(config),
    () => get('PUBLIC_APP_URL') && resolvePublicAppUrl(config),
    () =>
      get('NODE_ENV') === 'production' &&
      get('ENABLE_API_DOCS') === 'true' &&
      requireDocsCredentials(get('API_DOCS_USER'), get('API_DOCS_PASSWORD')),
  ];
  const errors = checks.flatMap((check) => {
    try {
      check();
      return [];
    } catch (err) {
      return [err instanceof Error ? err.message : String(err)];
    }
  });
  return errors.length === 0
    ? { ok: true, output: 'config ok' }
    : { ok: false, output: errors.join('\n') };
}

/** The deploy container always runs as production, so the CLI judges it that way
 * whatever NODE_ENV the host `.env` says (a dev `.env` must not print a false "config ok"). */
export function runProductionConfigCheck(env: Record<string, unknown>) {
  return runConfigCheck({ ...env, NODE_ENV: 'production' });
}

/** Cloudflare's published always-pass Turnstile secret: staging sign-ups work, no real key is stored. */
export const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

// Every variable that can reach a real SMS / WhatsApp / email / push provider (.env.example).
// Provider prefixes come from the registry (no hand list); the rest are the `<MEDIUM>_PROVIDER`
// keys and non-registry leftovers. `MESSAGE_SINK` is required on staging/demo, so it is not here.
const INSTANCES = MESSAGING_PROVIDERS.map((P) => new P());
const REGISTRY_PREFIXES = INSTANCES.map((p) => p.envPrefix);
const PROVIDER_VAR = new RegExp(
  `^(${[...new Set([...REGISTRY_PREFIXES, ...Object.values(CommunicationMedium).map((m) => String(m)), 'MESSENGER', 'VAPID', 'PLATFORM_SMS'])].join('|')})_`,
);
// Prod rule only: the platform SMS provider is chosen among SMS providers; a prod with only email keys is fine.
const SMS_INSTANCES = INSTANCES.filter((p) => p.descriptor.medium === CommunicationMedium.SMS);
const SMS_PREFIXES = SMS_INSTANCES.map((p) => p.envPrefix);
const SMS_PROVIDER_NAMES = SMS_INSTANCES.map((p) => p.descriptor.name);
// Also refused on staging: real alert phones and social sign-in (real accounts) credentials.
const EXTRA_REFUSED = /^(PLATFORM_ALERT_PHONES|GOOGLE_OAUTH_|FACEBOOK_OAUTH_)/;
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

export type Stack = 'prod' | 'staging' | 'demo';

/**
 * What deploy/stack.yml hands the app that the host `.env` does not hold: the database URL is
 * built from POSTGRES_*, and the bucket falls back to the prod default. The check judges the
 * env the container really gets.
 */
export function composeAppEnv(env: Record<string, unknown>): Record<string, unknown> {
  const str = (k: string) => String(env[k] ?? '');
  return {
    ...env,
    // Same defaults and fixed values as the x-app block of deploy/stack.yml.
    S3_BUCKET: str('S3_BUCKET') || 'biddaloy',
    SENTRY_TRACES_SAMPLE_RATE: str('SENTRY_TRACES_SAMPLE_RATE') || '0.1',
    DB_SSL: 'true',
    // After ...env: compose builds it, a DATABASE_URL in the host file is never used.
    DATABASE_URL: `postgres://${str('POSTGRES_USER')}:${str('POSTGRES_PASSWORD')}@db:5432/${str('POSTGRES_DB')}?sslmode=require`,
  };
}

// The `:?` variables of deploy/stack.yml for every stack, plus what each stack adds
// (a spec keeps the common part equal to the compose file).
export const COMMON_REQUIRED = [
  'ENV_NAME',
  'APP_VERSION',
  'POSTGRES_USER',
  'POSTGRES_DB',
  'POSTGRES_PASSWORD',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
];
const EXTRA_REQUIRED: Record<Stack, string[]> = {
  prod: ['BACKUP_AGE_PUBLIC_KEY'],
  // What scripts/backup/staging-refresh.sh refuses to run without, plus the login itself.
  staging: [
    'STAGING_PASSWORD',
    'STAGING_PASSWORD_HASH_B64',
    'PLATFORM_TENANT_ID',
    'SMOKE_SCHOOL_SLUG',
    'BACKUP_S3_ENDPOINT',
    'BACKUP_S3_BUCKET',
    'BACKUP_S3_ACCESS_KEY_ID',
    'BACKUP_S3_SECRET_ACCESS_KEY',
  ],
  demo: ['DEMO_PASSWORD'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The shape staging-refresh.sh accepts: bcrypt, cost 12 (Rule 9).
const BCRYPT_12 = /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/;

/**
 * Staging: the same shape checks staging-refresh.sh runs, so a bad value fails at deploy and not
 * at 02:00. The hash travels base64-encoded (compose expands every `$` of a raw bcrypt hash) and
 * must be the hash of STAGING_PASSWORD, or the smoke login breaks after the first refresh.
 * Prod's rclone crypt password never goes to staging: it reads db/ dumps only.
 */
async function stagingRefreshErrors(val: (k: string) => string): Promise<string[]> {
  const errors: string[] = [];
  if (val('PLATFORM_TENANT_ID') && !UUID.test(val('PLATFORM_TENANT_ID'))) {
    errors.push('PLATFORM_TENANT_ID must be a uuid on staging');
  }
  if (val('SMOKE_SCHOOL_SLUG') && !/^[a-z0-9-]+$/.test(val('SMOKE_SCHOOL_SLUG'))) {
    errors.push('SMOKE_SCHOOL_SLUG must be lowercase letters, digits and dashes');
  }
  if (val('BACKUP_S3_ENDPOINT') && !val('BACKUP_S3_ENDPOINT').startsWith('https://')) {
    errors.push('BACKUP_S3_ENDPOINT must start with https://');
  }
  for (const k of ['BACKUP_RCLONE_CRYPT_PASSWORD', 'BACKUP_RCLONE_CRYPT_SALT']) {
    if (val(k)) errors.push(`${k} must be empty on staging (prod's file backup key)`);
  }
  if (val('STAGING_PASSWORD_HASH_B64')) {
    const b64 = val('STAGING_PASSWORD_HASH_B64');
    // Strict alphabet: Node skips stray characters that busybox `base64 -d` would choke on.
    const hash = /^[A-Za-z0-9+/]+={0,2}$/.test(b64) ? Buffer.from(b64, 'base64').toString() : '';
    if (!BCRYPT_12.test(hash)) {
      errors.push('STAGING_PASSWORD_HASH_B64 must be the base64 of a bcrypt cost-12 hash');
    } else if (val('STAGING_PASSWORD') && !(await verifyPassword(val('STAGING_PASSWORD'), hash))) {
      errors.push('STAGING_PASSWORD_HASH_B64 is not the hash of STAGING_PASSWORD');
    }
  }
  return errors;
}

/**
 * `--env prod|staging|demo`: the production checks on the env the container gets, plus the
 * rules of that stack. Provider variables are judged on the host file itself. Names variables
 * only, never values.
 */
export async function runStackConfigCheck(
  stack: Stack,
  env: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const base = runProductionConfigCheck(composeAppEnv(env));
  const val = (k: string) => (typeof env[k] === 'string' ? (env[k] as string) : '');
  const set = (k: string) => val(k) !== '';
  const errors: string[] = [
    ...[...COMMON_REQUIRED, ...EXTRA_REQUIRED[stack]]
      .filter((k) => !set(k))
      .map((k) => `${k} must be set`),
    ...(set('ENV_NAME') && val('ENV_NAME') !== stack ? [`ENV_NAME must be ${stack}`] : []),
    // Both Turnstile keys or neither: a lone key breaks or silently disables the public forms.
    ...(set('TURNSTILE_SITE_KEY') !== set('TURNSTILE_SECRET_KEY')
      ? ['TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set together']
      : []),
  ];
  // One-off runners: `docker compose run <service>` turns their profile on by itself. Set here,
  // `up -d` would start them too (entrypoint [] and no command).
  const profiles = val('COMPOSE_PROFILES')
    .split(',')
    .map((p) => p.trim());
  for (const p of ['jobs', 'demo-jobs']) {
    if (profiles.includes(p)) errors.push(`COMPOSE_PROFILES must not contain ${p}`);
  }
  // [87 D3, D10] the test inbox: never on prod, always on every other stack.
  if (stack === 'prod' && val('MESSAGE_SINK') === 'mailpit') {
    errors.push('MESSAGE_SINK must not be mailpit on prod');
  }
  // The `sink` profile makes the mailpit container part of the stack (a long-running service,
  // not a one-off runner).
  if (stack === 'prod' && profiles.includes('sink')) {
    errors.push('COMPOSE_PROFILES must not contain sink on prod');
  }
  // [87] staging may opt out of the inbox on purpose; demo and prod never can.
  const realOnStaging = stack === 'staging' && val('ALLOW_REAL_PROVIDERS_ON_STAGING') === 'true';
  if (val('ALLOW_REAL_PROVIDERS_ON_STAGING') && stack !== 'staging') {
    errors.push(`ALLOW_REAL_PROVIDERS_ON_STAGING must not be set on ${stack}`);
  }
  if (stack !== 'prod' && !realOnStaging) {
    if (!profiles.includes('sink')) errors.push(`COMPOSE_PROFILES must contain sink on ${stack}`);
    if (val('MESSAGE_SINK') !== 'mailpit') errors.push(`MESSAGE_SINK must be mailpit on ${stack}`);
    if (!set('MESSAGE_SINK_PUBLIC_URL')) {
      errors.push(`MESSAGE_SINK_PUBLIC_URL must be set on ${stack}`);
    }
  }
  // [97 D3] SMS_PROVIDER must name a registered SMS provider, and is needed once an SMS key is set.
  if (stack === 'prod') {
    const smsKey = Object.keys(env).some(
      (k) => SMS_PREFIXES.some((p) => k.startsWith(`${p}_`)) && set(k),
    );
    if ((set('SMS_PROVIDER') || smsKey) && !SMS_PROVIDER_NAMES.includes(val('SMS_PROVIDER'))) {
      errors.push('SMS_PROVIDER must name a registered SMS provider');
    } else if (set('SMS_PROVIDER')) {
      // Keys only, never values: every required field of the chosen provider must be set.
      const chosen = SMS_INSTANCES.find((p) => p.descriptor.name === val('SMS_PROVIDER'));
      const missing = (chosen?.descriptor.fields ?? [])
        .filter((f) => f.required)
        .map((f) => envName(chosen!.envPrefix, f.key))
        // Blank or spaces only is missing too: a key of spaces passes no vendor.
        .filter((k) => val(k).trim() === '');
      if (missing.length > 0) errors.push(`SMS_PROVIDER needs ${missing.join(', ')} on prod`);
    }
  }
  if (stack === 'prod' && val('DEMO_MODE') === 'true') {
    errors.push('DEMO_MODE must not be true on prod');
  }
  if (
    stack === 'prod' &&
    (val('TURNSTILE_SITE_KEY') === TURNSTILE_TEST_SITE_KEY ||
      val('TURNSTILE_SECRET_KEY') === TURNSTILE_TEST_SECRET)
  ) {
    errors.push("TURNSTILE_* must not be Cloudflare's always-pass test keys on prod");
  }
  if (stack !== 'prod') {
    // A non-prod stack must not touch a prod resource: it has its own database and bucket.
    if (set('POSTGRES_DB') && val('POSTGRES_DB') !== `biddaloy_${stack}`) {
      errors.push(`POSTGRES_DB must be biddaloy_${stack}`);
    }
    if (val('S3_BUCKET') !== `biddaloy-${stack}`) {
      errors.push(`S3_BUCKET must be biddaloy-${stack} (never the prod bucket)`);
    }
    // The backup and replica profiles of prod must not start on another stack.
    for (const p of ['backup', 'replica']) {
      if (profiles.includes(p)) errors.push(`COMPOSE_PROFILES must not contain ${p} on ${stack}`);
    }
    // No real SMS / WhatsApp / email / push provider (nor, on staging, real alert phones or
    // social sign-in credentials) on a non-prod stack: the test inbox takes every message.
    errors.push(
      ...Object.keys(env)
        .filter(
          (k) => (PROVIDER_VAR.test(k) || (stack === 'staging' && EXTRA_REFUSED.test(k))) && set(k),
        )
        .map(
          (k) => `${k} must be empty on ${stack} (no real SMS / WhatsApp / email / push provider)`,
        ),
    );
    // No offsite backup target on a non-prod stack (it could overwrite prod's backups).
    if (stack === 'demo') {
      errors.push(
        ...Object.keys(env)
          .filter((k) => k.startsWith('BACKUP_S3_') && set(k))
          .map((k) => `${k} must be empty on demo`),
      );
    }
  }
  if (stack === 'staging') {
    // Prod data is refused under demo mode (demo-boot-check.ts), so staging runs with it off.
    if (val('DEMO_MODE') !== 'false') errors.push('DEMO_MODE must be false on staging');
    if (set('STAGING_PASSWORD') && val('STAGING_PASSWORD').length < 12) {
      errors.push('STAGING_PASSWORD must be at least 12 characters');
    }
    if (val('TURNSTILE_SITE_KEY') !== TURNSTILE_TEST_SITE_KEY) {
      errors.push("TURNSTILE_SITE_KEY must be Cloudflare's always-pass test key on staging");
    }
    if (set('TURNSTILE_SECRET_KEY') && val('TURNSTILE_SECRET_KEY') !== TURNSTILE_TEST_SECRET) {
      errors.push("TURNSTILE_SECRET_KEY must be Cloudflare's always-pass test secret on staging");
    }
    errors.push(...(await stagingRefreshErrors(val)));
  }
  if (stack === 'demo' && val('DEMO_MODE') !== 'true')
    errors.push('DEMO_MODE must be true on demo');
  const all = [...new Set([...(base.ok ? [] : base.output.split('\n')), ...errors])];
  // [88 U3] STAGING_REFRESH_PUSH_URL was renamed; the old name still works for one release.
  const warning =
    stack === 'staging' && set('STAGING_REFRESH_PUSH_URL') && !set('RESTORE_DRILL_PUSH_URL')
      ? '\nwarning: STAGING_REFRESH_PUSH_URL is renamed RESTORE_DRILL_PUSH_URL; the old name is accepted for one more release'
      : '';
  return all.length === 0
    ? { ok: true, output: `config ok${warning}` }
    : { ok: false, output: all.join('\n') + warning };
}

/**
 * With `--file`, the file's contents are the whole env: the controller's own process.env
 * (a shell with SMTP_* or a prod secret exported) must not leak into the verdict.
 */
export function loadEnvFile(file: string | undefined, processEnv: Record<string, unknown>) {
  return file ? parse(readFileSync(file)) : processEnv;
}

if (require.main === module) {
  // `--file <path>` reads that env file instead of the repo-root .env (deploy.yml pipes the
  // decrypted secrets in via /dev/stdin, so staging is checked before anything is written).
  const arg = (name: string) => {
    const at = process.argv.indexOf(name);
    return at > -1 ? process.argv[at + 1] : undefined;
  };
  const file = arg('--file');
  if (!file) config({ path: resolve(__dirname, '..', '..', '..', '.env') });
  const target = arg('--env') ?? 'prod';
  if (target !== 'prod' && target !== 'staging' && target !== 'demo') {
    console.error('Usage: config:check [--env prod|staging|demo] [--file <path>]');
    process.exit(2);
  }
  void runStackConfigCheck(target, loadEnvFile(file, process.env)).then(({ ok, output }) => {
    (ok ? console.log : console.error)(output);
    process.exit(ok ? 0 : 1);
  });
}
