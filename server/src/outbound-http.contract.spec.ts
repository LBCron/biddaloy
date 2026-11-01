import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Contract test [75.24]: server code may only make an outbound HTTP call from
 * the SSRF-safe helper, or from a file listed in REVIEWED_OUTBOUND below.
 *
 * Why: a URL a user or tenant can influence (a webhook, an SMS gateway
 * `apiUrl`, a push endpoint) can point at `169.254.169.254` or an internal
 * service. Those must go through `assertSafeHttpDestination` +
 * `fetchPinnedJson` (communications/providers/shared/pinned-http.ts).
 *
 * Fixing a failure:
 *   - the URL comes from a request, a tenant setting or a DB row -> use the
 *     pinned helper. Never allowlist it.
 *   - the host is a code constant or operator config (env) -> add the file to
 *     REVIEWED_OUTBOUND with the host and who controls it.
 *   - UNSAFE entries are known gaps waiting for a fix; do not copy the pattern.
 *
 * What counts as an outbound call (comments are stripped first):
 *   - `fetch(` (global fetch or an undici import), not `.fetch(` method calls
 *   - an import of undici, axios, got, node-fetch, superagent, ky, needle,
 *     @nestjs/axios, or a non-type import of node http/https/http2
 *   - `http.request(` / `https.get(` and friends
 *   - `.sendNotification(` (web-push posts to the subscription endpoint)
 *   - SDK clients that take a URL from config: `new S3Client(`,
 *     `nodemailer.createTransport(`, `Sentry.init(`
 *
 * Known blind spots (not caught):
 *   - a URL fetched through a wrapper or a new library not listed above
 *   - `require()` with a variable, or `import()` of a network library
 *   - a reviewed file that later gets a second, unsafe call (the entry is per
 *     file, not per call)
 *   - non-HTTP outbound traffic: Redis, Postgres, SMTP sockets, BullMQ
 *   - `stripComments` is not string-aware: a `/*` inside a string (e.g.
 *     '**\/*.ts') or `//` inside a template (`${a}//${b}`) can swallow code
 *     after it, hiding a call on that line or in the rest of the file
 *   - code outside `server/src` (`server/test`, other packages)
 * ponytail: per-file guard only; a lint rule banning global `fetch` would be
 * stricter if new callers keep appearing.
 *
 * Skips `*.spec.ts` and `*.e2e-spec.ts`.
 */
const SRC_DIR = __dirname;

/** The one SSRF-safe path. Exempt by definition. */
const HELPER = 'modules/communications/providers/shared/pinned-http.ts';

const PATTERNS: RegExp[] = [
  // not `.fetch(`, and not a method declaration (`private async fetch(`)
  /(?<![.\w$])(?<!(?:async|function)\s+)fetch\(/,
  // `globalThis.fetch(...)` and friends
  /\b(?:globalThis|global|self|window)\.fetch\b/,
  // bare `fetch` used as a value: `const f = fetch`, `fetch.bind(...)`, `x ?? fetch`
  /(?:[=:,?(]|\?\?|\|\|)\s*fetch\s*(?:[;,)\n]|\.bind\b)/,
  /\bfetch\.(?:bind|call|apply)\(/,
  // runtime imports and re-exports only: `import type { X } from '@aws-sdk/client-s3'` opens nothing
  /\b(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+'(?:undici|axios|got|node-fetch|superagent|ky|needle|ws|@nestjs\/axios|@aws-sdk\/client-[\w-]+)'/,
  // net/tls only when a socket can be opened (`isIP` alone is a pure helper)
  /import\s+(?!type\b)(?:\*\s+as\s+\w+|\w+|\{[^}]*\b(?:connect|createConnection|Socket)\b[^}]*\})\s+from\s+'(?:node:)?(?:net|tls)'/,
  /import\(\s*'(?:node:)?(?:https?|http2|net|tls|undici|axios|got|ws|node-fetch)'\s*\)/,
  /\bnew (?!S3Client\b)\w+Client\(/,
  /import\s+(?!type\b)(?:\*\s+as\s+\w+|\w+|\{[^}]*\b(?:request|get)\b[^}]*\})\s+from\s+'(?:node:)?https?'/,
  /require\('(?:node:)?(?:https?|http2|axios|got)'\)/,
  /\b(?:https?|http2)\.(?:request|get)\(/,
  /\.sendNotification\(/,
  /new S3Client\(/,
  /\bcreateTransport\(/,
  /\bSentry\.init\(/,
];

/**
 * Per file (relative to server/src): host and who controls the URL. Audited 2026-10-13.
 * Reviewed seam (#3324): `outbound-destination-guard.ts` lets http://127.0.0.1 through only when
 * NODE_ENV=test AND OUTBOUND_TEST_ALLOW_LOOPBACK=true (boot refuses the flag in production).
 * It is the guard itself, so it makes no call and needs no entry here; the last test below pins
 * that no other file reads the flag.
 */
const REVIEWED_OUTBOUND: Record<string, string> = {
  'scripts/load/run-dashboard-load.ts':
    'manual operator tool: LOAD_BASE_URL is operator config and the script refuses any host that is not localhost / 127.0.0.1 / ::1',
  'modules/communications/providers/whatsapp/meta-cloud.provider.ts':
    'graph.facebook.com constant host; tenant path ids are checked by isValidGraphApiId',
  'modules/communications/providers/messenger/meta-page.provider.ts':
    'graph.facebook.com constant host; tenant pageId is checked by isValidGraphApiId',
  'modules/auth/social/providers/google.provider.ts': 'TOKEN_URL constant (Google OAuth)',
  'modules/auth/social/providers/facebook.provider.ts': 'GRAPH constant (graph.facebook.com)',
  'modules/registration/turnstile.service.ts': 'challenges.cloudflare.com constant',
  'modules/calendar/public-holiday-fetch.service.ts':
    'calendar.google.com and date.nager.at constant hosts; path from a validated country code',
  'modules/attention/health/sentry-cron.ts':
    'SENTRY_CRON_URL env, operator config (may be a private self-hosted Sentry)',
  'modules/push/push.service.ts':
    'web-push to the subscription endpoint; CreatePushSubscriptionDto allowlists known push-service hosts over https',
  'modules/communications/providers/email/smtp.provider.ts':
    'SMTP host is checked by assertSafeSmtpDestination before the transport is created',
  'modules/communications/providers/sink/mailpit-sink.provider.ts':
    'fixed compose alias mailpit:1025 or operator env MESSAGE_SINK_SMTP_URL; never tenant-influenced; only reached when MESSAGE_SINK=mailpit, which boot refuses on prod (D5, D22)',
  'modules/storage/storage.service.ts': 'S3_ENDPOINT env, operator config',
  'common/sentry.ts': 'SENTRY_DSN env, operator config',
};

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.e2e-spec.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Removes block and line comments; `(^|[^:])` keeps the `//` in `https://`. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function matches(source: string): boolean {
  const code = stripComments(source);
  return PATTERNS.some((re) => re.test(code));
}

/** Files (relative to server/src) with an outbound call, helper included. */
function findOutboundFiles(): string[] {
  return collectFiles(SRC_DIR)
    .filter((file) => matches(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC_DIR, file));
}

describe('outbound HTTP guard', () => {
  it('no outbound HTTP call outside the pinned helper or the reviewed list', () => {
    const unreviewed = findOutboundFiles().filter(
      (file) => file !== HELPER && !(file in REVIEWED_OUTBOUND),
    );
    expect(
      unreviewed,
      'a URL that a user or tenant can influence must go through assertSafeHttpDestination + fetchPinnedJson (communications/providers/shared/pinned-http.ts). A fixed code-constant host or operator config may be added to REVIEWED_OUTBOUND with a reason',
    ).toEqual([]);
  });

  it('no reviewed entry is stale', () => {
    const found = new Set(findOutboundFiles());
    const stale = [HELPER, ...Object.keys(REVIEWED_OUTBOUND)]
      .filter((file) => !found.has(file))
      .map((file) => `${file}: no outbound call found - remove the entry`);
    expect(stale).toEqual([]);
  });

  it('the matcher sees what it should (and ignores comments and method calls)', () => {
    expect(matches('await fetch(dto.url)')).toBe(true);
    expect(matches("import axios from 'axios';")).toBe(true);
    expect(matches("import * as https from 'https';")).toBe(true);
    expect(matches('https.get(url)')).toBe(true);
    expect(matches('await webpush.sendNotification(sub, body)')).toBe(true);
    expect(matches("import type { IncomingMessage } from 'http';")).toBe(false);
    expect(matches('await this.fetch(country, year)')).toBe(false);
    expect(matches('private async fetch(id: string) {}')).toBe(false);
    expect(matches('await globalThis.fetch(u)')).toBe(true);
    expect(matches('const f = fetch;')).toBe(true);
    expect(matches('const f = fetch.bind(globalThis);')).toBe(true);
    expect(matches("const h = await import('node:https');")).toBe(true);
    expect(matches("import { isIP } from 'node:net';")).toBe(false);
    expect(matches("import { connect } from 'node:net';")).toBe(true);
    expect(matches("import { SESClient } from '@aws-sdk/client-ses';")).toBe(true);
    expect(matches("import {\n  S3Client,\n} from '@aws-sdk/client-s3';")).toBe(true);
    expect(matches("import type { S3ClientConfig } from '@aws-sdk/client-s3';")).toBe(false);
    expect(matches("export { default as http } from 'axios';")).toBe(true);
    expect(matches("export * from '@aws-sdk/client-ses';")).toBe(true);
    expect(matches("export type { AxiosResponse } from 'axios';")).toBe(false);
    expect(matches('// used with fetch() and an axios client\nconst a = 1;')).toBe(false);
    expect(matches('/* fetch(x) */ const a = 1;')).toBe(false);
    expect(matches("const u = 'https://a.b'; await fetch(u)")).toBe(true);
  });

  it('only the guard and the boot check read OUTBOUND_TEST_ALLOW_LOOPBACK (#3324)', () => {
    const readers = collectFiles(SRC_DIR)
      .filter((f) => readFileSync(f, 'utf8').includes('OUTBOUND_TEST_ALLOW_LOOPBACK'))
      .map((f) => relative(SRC_DIR, f))
      .sort();
    expect(readers).toEqual([
      'config/env.validation.ts',
      'modules/communications/providers/shared/outbound-destination-guard.ts',
    ]);
  });
});
