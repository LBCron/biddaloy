#!/usr/bin/env node
/**
 * [15.6] `yarn test:affected` — maps changed files to the Vitest
 * `projects` (and the server's own unit suite) that actually need to run,
 * instead of the full ~68s frontend suite plus the ~8s server suite on
 * every change, no matter how small.
 *
 * This is a workspace-boundary filter, not a module-graph one: it maps
 * *changed paths* to *owning packages*, using the package dependency graph
 * ground-truthed for #441 (`rg -l` import counts) —
 *
 *   client-admin -> ui -> shared          server -> shared
 *   (no edges the other direction; shared -> nothing)
 *
 * — not an import-by-import analysis of which test file actually exercises
 * which changed line. That's deliberately coarse: a `ui/**` change always
 * re-runs `client-admin`'s projects too (ui fans out into client-admin),
 * and `shared/**` always re-runs everything. See the mapping table below
 * and README's "Frontend Testing" section for the honest win table this
 * coarseness produces per change shape.
 *
 * Usage:
 *   node scripts/test-affected.mjs [--dry-run] [--files] [--base <ref>] [--all]
 *
 *   --dry-run   Print the resolved plan and exit 0. Runs nothing.
 *   --files     Tighten the frontend run with Vitest's own `--changed
 *               <merge-base>` on top of the project selection above. This
 *               is file-granular (only files Vitest's own dependency graph
 *               says are affected actually run), but it won't react to a
 *               config-only change (e.g. `vitest.config.ts` itself) the
 *               way the project-level mapping below does — use both.
 *   --base ref  Compare against `ref` instead of `origin/main` (or
 *               `AFFECTED_BASE`, if set).
 *   --all       Skip file resolution; run every project and the server
 *               unit suite. Escape hatch for "just run everything".
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Pure mapping — no fs, no git, no spawning. See test-affected.spec.mjs.
// ---------------------------------------------------------------------------

/**
 * The five packages `frontendPackage()`/the standalone `shared:node` entry
 * in `vitest.config.ts` define, plus the `scripts:node` project ([15.1]/
 * #436). Order here is the order projects print/run in — kept stable so a
 * dry-run's output doesn't reshuffle from one run to the next.
 */
export const ALL_FRONTEND_FIVE = Object.freeze([
  'ui:node',
  'ui:jsdom',
  'client-admin:node',
  'client-admin:jsdom',
  'shared:node',
]);
export const SCRIPTS_PROJECT = 'scripts:node';
export const LANDING_PROJECT = 'landing';
// [40.1.03] site theme manifests. A `site-themes/` change is unmapped below, so it runs everything.
export const SITE_THEMES_PROJECT = 'site-themes:node';
export const ALL_PROJECTS = Object.freeze([
  ...ALL_FRONTEND_FIVE,
  SITE_THEMES_PROJECT,
  SCRIPTS_PROJECT,
  LANDING_PROJECT,
]);

const UI_PROJECTS = ['ui:node', 'ui:jsdom', 'client-admin:node', 'client-admin:jsdom'];
const CLIENT_ADMIN_PROJECTS = ['client-admin:node', 'client-admin:jsdom'];

// A change to any of these can invalidate every project's config or
// dependency resolution at once — safest to just run everything.
const TOP_LEVEL_CONFIG_FILES = new Set([
  'vitest.config.ts',
  'package.json',
  'yarn.lock',
  'tsconfig.base.json',
  'tsconfig.frontend.json',
  '.nvmrc',
  'lint-staged.config.mjs',
]);

const PLAYWRIGHT_NOTE = 'Playwright specs affected; run `yarn e2e` (not covered by test:affected).';

/** One file -> { frontendProjects, server, note? }. */
function classify(file) {
  if (TOP_LEVEL_CONFIG_FILES.has(file)) {
    return { frontendProjects: ALL_PROJECTS, server: true };
  }
  if (file.startsWith('shared/')) {
    return { frontendProjects: ALL_FRONTEND_FIVE, server: true };
  }
  if (file.startsWith('ui/')) {
    return { frontendProjects: UI_PROJECTS, server: false };
  }
  if (file.startsWith('client-admin/')) {
    return { frontendProjects: CLIENT_ADMIN_PROJECTS, server: false };
  }
  if (file.startsWith('landing/')) {
    return { frontendProjects: [LANDING_PROJECT], server: false };
  }
  if (file.startsWith('server/')) {
    return { frontendProjects: [], server: true };
  }
  if (file.startsWith('scripts/')) {
    return { frontendProjects: [SCRIPTS_PROJECT], server: false };
  }
  if (file.startsWith('e2e/') || /^playwright[^/]*\.config\.ts$/.test(file)) {
    return { frontendProjects: [], server: false, note: PLAYWRIGHT_NOTE };
  }
  if (
    file.startsWith('docs/') ||
    file.endsWith('.md') ||
    file.startsWith('.github/') ||
    file.startsWith('nginx/') ||
    file.startsWith('graphify-out/')
  ) {
    return { frontendProjects: [], server: false };
  }
  // Unmatched path this table has never seen — the safe default is to run
  // everything and say so loudly, not to silently under-test it. Extend the
  // table above once the new path's real owner is known.
  return {
    frontendProjects: ALL_PROJECTS,
    server: true,
    note: `unmapped path "${file}" — running everything. Add a rule for it above once its owning package is known.`,
  };
}

/**
 * `changedFiles` -> `{ frontendProjects, runServerUnit, notes }`. Pure:
 * takes a plain array of repo-relative paths, does no I/O of its own.
 */
export function resolveAffected(changedFiles) {
  const projects = new Set();
  let runServerUnit = false;
  const notes = [];
  const seenNotes = new Set();

  for (const file of changedFiles) {
    const { frontendProjects, server, note } = classify(file);
    for (const p of frontendProjects) projects.add(p);
    if (server) runServerUnit = true;
    if (note && !seenNotes.has(note)) {
      seenNotes.add(note);
      notes.push(note);
    }
  }

  return {
    frontendProjects: ALL_PROJECTS.filter((p) => projects.has(p)),
    runServerUnit,
    notes,
  };
}

// ---------------------------------------------------------------------------
// I/O — git + spawning. Not covered by test-affected.spec.mjs (which stays
// pure); exercised manually per #441's PR description.
// ---------------------------------------------------------------------------

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Changed files usable *mid-edit*, not just what's already committed:
 * everything since `base` diverged from HEAD, plus staged changes, plus
 * unstaged changes to tracked files, plus untracked files. Deduped.
 */
function getChangedFiles(base) {
  const files = new Set();
  let mergeBase = base;
  try {
    mergeBase = git(['merge-base', base, 'HEAD'])[0] ?? base;
  } catch {
    console.error(
      `test-affected: could not resolve merge-base for "${base}" — comparing against it directly.`,
    );
  }
  for (const f of git(['diff', '--name-only', `${mergeBase}...HEAD`])) files.add(f);
  for (const f of git(['diff', '--name-only'])) files.add(f); // unstaged
  for (const f of git(['diff', '--name-only', '--cached'])) files.add(f); // staged
  for (const f of git(['ls-files', '--others', '--exclude-standard'])) files.add(f); // untracked
  return { changedFiles: [...files], mergeBase };
}

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  return result.status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const tightenFiles = args.includes('--files');
  const all = args.includes('--all');
  if (all && tightenFiles) {
    console.error(
      'test-affected: --all runs every test; --files (narrow to changed files) makes no sense with it.',
    );
    process.exit(1);
  }
  const baseFlagIndex = args.indexOf('--base');
  const base =
    baseFlagIndex !== -1 ? args[baseFlagIndex + 1] : process.env.AFFECTED_BASE || 'origin/main';

  let plan;
  let mergeBase = base;
  if (all) {
    plan = {
      frontendProjects: ALL_PROJECTS,
      runServerUnit: true,
      notes: ['--all: running everything.'],
    };
  } else {
    const changed = getChangedFiles(base);
    mergeBase = changed.mergeBase;
    plan = resolveAffected(changed.changedFiles);
    console.log(`test-affected: base=${base} (merge-base ${mergeBase})`);
    console.log(`test-affected: ${changed.changedFiles.length} changed file(s).`);
  }

  console.log(
    `test-affected: frontend projects: ${plan.frontendProjects.length ? plan.frontendProjects.join(', ') : '(none)'}`,
  );
  console.log(`test-affected: server unit tests: ${plan.runServerUnit ? 'yes' : 'no'}`);
  for (const note of plan.notes) console.log(`test-affected: note: ${note}`);

  if (plan.frontendProjects.length === 0 && !plan.runServerUnit) {
    console.log('test-affected: nothing to do.');
    process.exit(0);
  }

  if (dryRun) {
    console.log('test-affected: --dry-run, not running anything.');
    process.exit(0);
  }

  let exitCode = 0;

  if (plan.frontendProjects.length > 0) {
    const vitestArgs = ['vitest', 'run'];
    for (const p of plan.frontendProjects) vitestArgs.push('--project', p);
    if (tightenFiles) vitestArgs.push('--changed', mergeBase);
    exitCode = Math.max(exitCode, run('npx', vitestArgs));
  }

  if (plan.runServerUnit) {
    exitCode = Math.max(exitCode, run('yarn', ['workspace', '@biddaloy/server', 'test:unit']));
  }

  process.exit(exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
