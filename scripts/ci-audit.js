#!/usr/bin/env node
/**
 * Gate CI on `yarn audit`. Two modes:
 *
 *   node scripts/ci-audit.js               all deps, fails on high/critical
 *                                          (dev tooling noise stays out)
 *   node scripts/ci-audit.js --production  production deps only
 *                                          (`--groups dependencies`), fails on
 *                                          moderate or worse: this code ships
 *                                          to users, so the bar is lower.
 *
 * An allowlist entry absent from a run is only printed as a note: a
 * dev-only entry is legitimately missing from the production run.
 *
 * Yarn 1's `--level` flag only filters what's printed — the process exit
 * code is a bitmask of every severity found (info=1, low=2, moderate=4,
 * high=8, critical=16), regardless of `--level`. A single low-severity
 * advisory would otherwise fail this job. This script re-implements the
 * filter correctly by reading `--json` output and only failing on
 * high/critical entries not present in ALLOWLIST below.
 *
 * Allowlisted advisories must carry a reason and a re-check date. The date
 * is enforced below, not just documentation — once it passes, this script
 * fails the job until someone re-reviews and picks a new date, so the
 * exception can't silently outlive its review window.
 */
const { spawnSync } = require('child_process');

// Prefer upgrading over allowlisting — an entry here is a standing
// exception, and both brace-expansion entries (#1124334, then #1130734)
// turned out to be avoidable: every consumer's own semver range already
// permitted a patched release, so refreshing the lockfile fixed it outright
// (#1130734 went once 1.1.21 landed in the lockfile). Before
// adding an entry, check whether the vulnerable package is actually pinned
// or merely stale.
const ALLOWLIST = {
  1139346: {
    module: 'extract-zip',
    reason:
      'Unvalidated symlink path traversal; no patched release exists ' +
      '(advisory lists <0.0.0 as patched). Reached only through ' +
      '@lhci/cli>lighthouse>puppeteer-core>@puppeteer/browsers ' +
      '(devDependency, #149), where extract-zip unpacks Chrome archives ' +
      "downloaded from Google's own distribution URLs — not " +
      'attacker-supplied zips. Re-check for an upstream fix release. ' +
      'Re-checked 2026-10-12: extract-zip 2.0.1 is still the newest release.',
    recheckBy: '2027-01-24',
  },
  1193685: {
    module: 'extract-zip',
    reason:
      'Follow-up disclosure on the same unpatched symlink issue as ' +
      '#1139346 above (arbitrary file writes via symlink archive ' +
      'entries) — extract-zip is still at 2.0.1, the newest release, so ' +
      'no upgrade fixes this. Same reachability as #1139346: only via ' +
      '@lhci/cli>lighthouse>puppeteer-core>@puppeteer/browsers ' +
      '(devDependency, #149) unpacking Chrome archives from Google, not ' +
      'attacker-supplied zips. Re-check for an upstream fix release. ' +
      'Re-checked 2026-10-12: extract-zip 2.0.1 is still the newest release.',
    recheckBy: '2027-01-24',
  },
  1119441: {
    module: 'uuid',
    reason:
      'Missing buffer bounds check in uuid v3/v5/v6 when a `buf` argument is ' +
      'passed. Reached via @biddaloy/server>exceljs>uuid (production) and ' +
      '@lhci/cli>uuid (dev). Both callers only use v4 with no buffer ' +
      '(exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js:1; ' +
      '@lhci/cli/src/collect/node-runner.js:65 calls uuid.v4()), so the ' +
      'vulnerable path is never called. Re-checked 2026-10-12: only v4 is ' +
      'required. Re-check after any exceljs or @lhci/cli upgrade.',
    recheckBy: '2027-01-24',
  },
  1243066: {
    module: 'zod',
    reason:
      'Memory exhaustion validating oversized constrained collections. ' +
      'Only the zod 3.25.76 copy is flagged; the app (shared/ui/' +
      'client-admin) already resolves zod 4.6.7, which is patched. The ' +
      '3.x copy is pulled only by chromium-bidi>zod (^3.24.1) via ' +
      'puppeteer and @lhci/cli (devDependencies, #149), which validate ' +
      'protocol messages from a local Chrome, not user input. No 3.x fix ' +
      'exists (patched is >=4.6.6) and forcing zod 4 under chromium-bidi ' +
      'risks breaking it. Re-check for a chromium-bidi release on zod 4. ' +
      'Added 2026-10-27.',
    recheckBy: '2027-01-24',
  },
  1244012: {
    module: 'minimatch',
    reason:
      'DoS via globparts amplification. Patched only in minimatch >=11.0.1, a new ' +
      'major the consumers do not support: typeorm>glob>minimatch 9, ' +
      'exceljs>archiver>archiver-utils>glob 7>minimatch 3, archiver>readdir-glob>' +
      'minimatch 5 (production); eslint, @nestjs/cli, workbox (dev/build). Patterns ' +
      'come from our own config and tooling (entity/migration globs, build globs), ' +
      'never from user input. Forcing majors risks runtime breakage; tracked in ' +
      '#3341. Added 2026-10-31.',
    recheckBy: '2026-11-30',
  },
  1244013: {
    module: 'glob',
    reason:
      'AbortSignal cancellation bypass after timeout (vulnerable >=9 <=14.0.1, patched ' +
      '>=14.0.2). Reached via typeorm>glob 10.5.0 (production) and dev/build glob ' +
      '11/13. Nothing here passes an AbortSignal or an untrusted pattern. typeorm ' +
      'pins glob ^10.5.0, so the fix needs a major bump upstream; tracked in ' +
      '#3341. Added 2026-10-31.',
    recheckBy: '2026-11-30',
  },
};

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

/**
 * Pure verdict: no spawn, no clock, no exit.
 * unallowed = advisories at/above minSeverity not in the allowlist (one per id)
 * expired   = allowlist ids whose recheckBy < today (string compare)
 * stale     = allowlist ids absent from this run (note only, never a failure)
 */
function evaluate({ advisories, allowlist, today, minSeverity }) {
  const min = SEVERITY_ORDER.indexOf(minSeverity);
  const byId = new Map();
  for (const a of advisories) if (!byId.has(a.id)) byId.set(a.id, a);
  const unique = [...byId.values()];
  const unallowed = unique.filter((a) => {
    const i = SEVERITY_ORDER.indexOf(a.severity);
    // Unknown severity string fails closed: treated as above the floor.
    return (i < 0 || i >= min) && !(a.id in allowlist);
  });
  const expired = Object.entries(allowlist)
    .filter(([, e]) => e.recheckBy < today)
    .map(([id]) => id);
  const stale = Object.keys(allowlist).filter((id) => !byId.has(Number(id)));
  const lines = unique.map((a) => {
    const status = a.id in allowlist ? 'ALLOWLISTED' : a.severity.toUpperCase();
    return `[${status}] #${a.id} ${a.severity} — ${a.module_name}: ${a.title}`;
  });
  return { unallowed, expired, stale, lines };
}

module.exports = { evaluate, ALLOWLIST, SEVERITY_ORDER };

if (require.main === module) {
  const production = process.argv.includes('--production');
  const minSeverity = production ? 'moderate' : 'high';
  const today = new Date().toISOString().slice(0, 10);

  const args = ['audit', '--json', ...(production ? ['--groups', 'dependencies'] : [])];
  const result = spawnSync('yarn', args, { encoding: 'utf8', timeout: 5 * 60 * 1000 });

  if (result.error) {
    console.error(`Failed to run yarn audit: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`yarn audit was terminated by signal ${result.signal} (possible timeout).`);
    process.exit(1);
  }

  const advisories = [];
  let sawSummary = false;
  for (const line of (result.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === 'auditAdvisory') advisories.push(entry.data.advisory);
    if (entry.type === 'auditSummary') sawSummary = true;
  }
  // A finished audit always ends with an auditSummary line. Without one the
  // audit did not run (registry outage, yarn error): fail closed, never "clean".
  if (!sawSummary) {
    console.error(
      `yarn audit produced no summary (exit ${result.status}); the audit did not complete.`,
    );
    if (result.stderr) console.error(result.stderr.slice(-2000));
    process.exit(1);
  }

  const { unallowed, expired, stale, lines } = evaluate({
    advisories,
    allowlist: ALLOWLIST,
    today,
    minSeverity,
  });
  lines.forEach((l) => console.log(l));
  if (stale.length > 0) {
    console.log(
      `\nNote: allowlist entries not seen in this run (ok if dev-only): ${stale.join(', ')}`,
    );
  }
  for (const id of expired) {
    console.error(
      `Allowlist entry #${id} expired its re-check date (${ALLOWLIST[id].recheckBy}) — ` +
        're-review and update ALLOWLIST in scripts/ci-audit.js before this can pass again.',
    );
  }
  if (unallowed.length > 0) {
    console.error(
      `\n${unallowed.length} new ${minSeverity}+ advisory(ies) found. ` +
        'Fix them or add a reasoned, dated entry to ALLOWLIST in scripts/ci-audit.js.',
    );
  }
  if (unallowed.length > 0 || expired.length > 0) process.exit(1);
  console.log(`\nNo unallowed ${minSeverity}+ advisories.`);
}
