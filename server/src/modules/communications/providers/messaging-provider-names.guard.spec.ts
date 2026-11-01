import { describe, it, expect } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { MESSAGING_PROVIDERS } from './messaging-providers';
import type { MessagingProvider } from './messaging-provider';

/**
 * D19: "one class + one line" is enforced by grep. A vendor name (greenweb, smtp, ...) may appear
 * only where it belongs, so adding a provider never means editing generic code.
 *
 *   generic code names a vendor  -> RED
 *   provider folder / list / docs / specs / example env -> allowed
 */
const REPO = resolve(__dirname, '../../../../..');
const ROOTS = ['server/src', 'client-admin/src', 'ui/src', 'shared/src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo']);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css)$/;

const PROVIDER_DIRS = [
  'server/src/modules/communications/providers/sms/',
  'server/src/modules/communications/providers/whatsapp/',
  'server/src/modules/communications/providers/email/',
  'server/src/modules/communications/providers/messenger/',
];
const ALLOWED_FILES = new Set([
  'server/src/modules/communications/providers/messaging-providers.ts',
  // The demo school's seed picks a provider on purpose (Epic 97 D6 shape); it has no other way to name one.
  'server/src/scripts/demo-seed/slices/comms-print.ts',
  // Test/story data for ProviderConfigForm: copies of the real server descriptors.
  'client-admin/src/pages/settings/provider-config-form.fixtures.ts',
  // #3339 data migration: rewrites rows that stored this exact company name; SQL cannot ask the list.
  'server/src/migrations/1791900002000-SmsDropUnownedGreenwebProvider.ts',
]);
/**
 * Files that name a vendor today, each with the reason. NOT a free pass: the list may only shrink
 * (a test below fails when an entry stops leaking, so remove it then). A new file never joins it.
 */
const KNOWN: Record<string, string> = {
  // protocol / prose, not a provider choice
  'server/src/config/env.validation.ts': 'smtp:// URL protocol of the sink',
  'server/src/modules/attention/rules/setup/comms-provider-missing.rule.ts': 'prose "email (SMTP)"',
  'server/src/modules/communications/delivery-error-code.ts': 'doc-comment example',
  'server/src/modules/communications/providers/shared/outbound-destination-guard.ts':
    'SMTP protocol guard',
  'server/src/modules/communications/providers/sink/mailpit-sink.provider.ts':
    'SMTP protocol of the sink',
  'server/src/rate-limit.ts': 'prose',
  'server/src/modules/workbook/tabs/school/school.tab.ts': 'comment naming a stored path',
  'shared/src/sms/segments.ts': 'doc-comment on gateway encodings',
  'ui/src/shells/form-shell-errors.ts': 'doc-comment example',
  'ui/src/test/msw/handlers/schools.ts': 'test fixture',
  // real debt, removed by the Epic 97 UI waves / platform-alert follow-up
  'ui/src/i18n/locales/en/settings.json': 'legacy per-vendor labels outside help.messaging',
};
const isTestFile = (p: string) => /\.(spec\.tsx?|test\.tsx?|stories\.tsx|e2e-spec\.ts)$/.test(p);
const isExampleEnv = (p: string) => /example\.env$|\.env\.example$/.test(p);
const isSettingsLocale = (p: string) => /^ui\/src\/i18n\/locales\/[^/]+\/settings\.json$/.test(p);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (TEXT.test(entry)) yield full;
  }
}

/** The text the guard must check, or null when the whole file is allowlisted. */
function checkedText(rel: string, full: string): string | null {
  if (
    PROVIDER_DIRS.some((d) => rel.startsWith(d)) ||
    ALLOWED_FILES.has(rel) ||
    isTestFile(rel) ||
    isExampleEnv(rel)
  ) {
    return null;
  }
  const text = readFileSync(full, 'utf8');
  if (!isSettingsLocale(rel)) return text;
  // Settings locales may name vendors only under help.messaging.*.
  const json = JSON.parse(text);
  delete json.help?.messaging;
  return JSON.stringify(json);
}

function findLeaks(roots: string[], base: string, names: string[]): string[] {
  const re = new RegExp(`\\b(${names.join('|')})\\b`, 'i');
  const leaks: string[] = [];
  for (const root of roots) {
    for (const full of walk(join(base, root))) {
      const rel = relative(base, full).split(sep).join('/');
      const hit = checkedText(rel, full)?.match(re);
      if (hit) leaks.push(`${rel}: "${hit[0]}"`);
    }
  }
  return leaks;
}

const names = MESSAGING_PROVIDERS.map(
  (P) => new (P as unknown as new () => MessagingProvider<unknown>)().descriptor.name,
);

// #3340: one walk of the whole repo per run, shared by the two tests that need it (each used to
// walk it again and could pass vitest's 5 s default on a loaded machine).
let repoLeaks: string[] | undefined;
const leaksInRepo = () => (repoLeaks ??= findLeaks(ROOTS, REPO, names));

describe('messaging provider names stay inside their own code (D19)', { timeout: 60_000 }, () => {
  it('knows the real provider names', () => {
    expect(names).toEqual(expect.arrayContaining(['greenweb', 'onecodesoft', 'smtp']));
  });

  it('no generic file names a vendor', () => {
    const unexpected = leaksInRepo().filter((l) => !(l.split(':')[0] in KNOWN));
    expect(unexpected).toEqual([]);
  });

  it('KNOWN only lists files that still leak (shrink it, never grow it)', () => {
    const leaking = new Set(leaksInRepo().map((l) => l.split(':')[0]));
    expect(Object.keys(KNOWN).filter((f) => !leaking.has(f))).toEqual([]);
  });

  it('negative case: a vendor name planted in a generic file is caught', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'name-guard-'));
    try {
      const dir = join(tmp, 'server/src/modules/schools/dto');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'tenant-settings.dto.ts'), "export const x = 'greenweb';\n");
      expect(findLeaks(['server/src'], tmp, names)).toEqual([
        'server/src/modules/schools/dto/tenant-settings.dto.ts: "greenweb"',
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
