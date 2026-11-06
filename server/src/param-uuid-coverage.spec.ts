import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * [75.13-b] Every `@Param('name')` in a controller must carry `ParseUUIDPipe`
 * so a malformed id gets 400 instead of reaching Postgres as a 500. Any other
 * pipe does not count. The params below are real non-UUID values and are the
 * only reviewed exceptions. Keys are `<path under src>:<param name>`; a bare
 * `@Param()` (the whole params object) has the name `(all)`. The number is how
 * many unpiped uses of that key the file has, so a new UUID `:id` route added
 * unpiped to an allowlisted file still fails.
 */
const NON_UUID_PARAMS = new Map<string, number>([
  ['modules/admission/public-admission.controller.ts:slug', 3], // school slug
  ['modules/auth/social/social-auth.controller.ts:provider', 4], // google / facebook
  ['modules/calendar/calendar-feed.controller.ts:token', 1], // opaque feed token
  ['modules/invoices/public-invoice.controller.ts:token', 1], // share-link token
  ['modules/notices/links/public-notice.controller.ts:token', 3], // notice link token (256-bit), not a UUID
  ['modules/print/verify/public-verify.controller.ts:token', 1], // verify token
  ['modules/website/public/public-site.controller.ts:host', 4], // site host name
  ['modules/website/public/public-site.controller.ts:page', 1], // SitePage name
  ['modules/website/public/public-site.controller.ts:kind', 1], // SiteIslandKind name
  ['modules/website/public/public-site.controller.ts:key', 1], // `logo` or a media id (service checks)
  ['modules/presets/presets.controller.ts:id', 1], // preset key such as bd/nctb
  ['modules/print/templates/print-templates.controller.ts:key', 1], // artwork key
  ['modules/print/templates/print-templates.controller.ts:side', 1], // artwork side name
  ['modules/staff-hr/staff-document.controller.ts:documentType', 1], // document type name
  ['modules/audit/audit.controller.ts:entityType', 1], // Student, Payment, ...
  ['modules/leave/leave.controller.ts:type', 1], // LeaveType, ParseEnumPipe
  ['modules/admission/applicant-review.controller.ts:type', 1], // AdmissionDocumentType, ParseEnumPipe
]);

const SRC_DIR = __dirname;
// `\s*` and `[^)]*` span newlines, so a call spread over several lines matches.
const PARAM_RE = /@Param\(\s*(?:['"](\w+)['"])?([^)]*)\)/g;

function collectControllers(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectControllers(fullPath));
    } else if (name.endsWith('.controller.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Every `@Param(...)` call outside comments: where it is and whether it has ParseUUIDPipe. */
function collectParams() {
  const found: { key: string; where: string; piped: boolean }[] = [];
  for (const file of collectControllers(SRC_DIR)) {
    const rel = relative(SRC_DIR, file);
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const m of text.matchAll(PARAM_RE)) {
      const line = text.slice(0, m.index).split('\n').length;
      if (/^\s*(\*|\/\/|\/\*)/.test(lines[line - 1])) continue; // doc comment or line comment
      const name = m[1] ?? '(all)';
      found.push({
        key: `${rel}:${name}`,
        where: `${rel}:${line} ${name}`,
        piped: /\bParseUUIDPipe\b/.test(m[2]),
      });
    }
  }
  return found;
}

/** Unpiped `@Param` uses per key. */
function unpipedCounts() {
  const counts = new Map<string, number>();
  for (const p of collectParams()) {
    if (!p.piped) counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
  }
  return counts;
}

describe('param UUID coverage', () => {
  it('every @Param is piped or allowlisted', () => {
    const counts = unpipedCounts();
    const offenders = collectParams()
      .filter((p) => !p.piped && (counts.get(p.key) ?? 0) > (NON_UUID_PARAMS.get(p.key) ?? 0))
      .map((p) => p.where);
    // Fix: add ParseUUIDPipe, or add a reviewed NON_UUID_PARAMS entry.
    expect(offenders, 'add ParseUUIDPipe, or add a reviewed NON_UUID_PARAMS entry').toEqual([]);
  });

  it('every allowlist entry still exists with its exact count', () => {
    const counts = unpipedCounts();
    const stale = [...NON_UUID_PARAMS].filter(([k, n]) => (counts.get(k) ?? 0) !== n);
    expect(stale, 'fix allowlist entries whose param is gone, now piped, or recounted').toEqual([]);
  });
});
