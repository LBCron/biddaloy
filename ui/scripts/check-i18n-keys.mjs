#!/usr/bin/env node
/**
 * Two blocking checks, one non-blocking report — the acceptance criteria
 * this exists for:
 *
 *  1. **Locale parity.** A key present in `locales/bn/<ns>.json` but absent
 *     from `locales/en/<ns>.json` (or vice versa) fails the build. A missing
 *     translation should fail CI, not silently render the raw key
 *     (`students.list.title`) to a school administrator.
 *
 *  2. **Every `t('key')` call site resolves to a real key**, in at least
 *     one locale (parity above catches the "only in one locale" half —
 *     this catches "in neither"). Namespace resolution: an explicit
 *     `{ ns: '...' }` option on the call wins; otherwise the nearest
 *     `useTranslation('...')` in the same file; otherwise `common`
 *     (mirrors `defaultNS` in `src/i18n/i18n.ts`).
 *
 *  3. **Unused keys are reported, not failed.** A key nothing references
 *     is cleanup, not breakage — surfaced so a translator/reviewer can act
 *     on it deliberately rather than have CI force the decision.
 *
 * Deliberately regex-based, not a real parser — this repo's other checks
 * (`check-exports.mjs`, `check-contrast.mjs`) are hand-rolled scripts too,
 * and the alternative (a full TS AST walk, or a heavier tool like
 * `i18next-parser`) is more machinery than four namespace files warrant
 * today. Known, accepted blind spot: a computed key (`t(someVariable)`)
 * can't be extracted and is silently not checked — same limitation every
 * static i18n-key linter has. `useTranslation(ns)` is resolved per file,
 * not per component/scope; a file with more than one component using
 * different namespaces needs an explicit `{ ns }` on each `t()` call to
 * be checked correctly (see `check-i18n-keys.spec.mjs` for a worked
 * example of exactly that ambiguity).
 *
 * `runCheck()`/`flattenKeys()` are exported for `check-i18n-keys.spec.mjs`
 * — everything else is this file's own implementation detail. `main()`
 * only runs when this file is executed directly (`node
 * check-i18n-keys.mjs`), not when the spec file imports it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LOCALES } from '../src/i18n/locale-storage.ts';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(pkgRoot, '..');

// Mirrors `COMMON_NAMESPACE` in src/i18n/i18n.ts — not imported directly
// (that module's top-level `createI18nInstance()` call has real side
// effects: it reaches for i18next/react-i18next and kicks off a dynamic
// resource load, none of which this static check needs or wants to pay
// for). Keep the two in sync by hand; there is exactly one such constant.
const DEFAULT_NAMESPACE = 'common';
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'coverage']);

// i18next's CLDR plural-form suffixes — a locale file defines
// `someKey_one`/`someKey_other` (etc.), never a bare `someKey`, but a call
// site still writes `t('someKey', { count })` with no suffix. Without this,
// every pluralized key would (wrongly) fail check 2 as unresolved and get
// reported as unused in check 3.
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function stripPluralSuffix(key) {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(`_${suffix}`)) return key.slice(0, -(suffix.length + 1));
  }
  return key;
}

export function flattenKeys(value, prefix = '') {
  const keys = [];
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      keys.push(...flattenKeys(nested, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/** `Map<namespace, Map<locale, Set<flattened key>>>`. */
function loadNamespaces(localesDir) {
  const namespaces = new Map();
  for (const locale of SUPPORTED_LOCALES) {
    const dir = join(localesDir, locale);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const ns = file.slice(0, -'.json'.length);
      const content = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const keys = new Set(flattenKeys(content));
      if (!namespaces.has(ns)) namespaces.set(ns, new Map());
      namespaces.get(ns).set(locale, keys);
    }
  }
  return namespaces;
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (
      // Test files may look up keys on purpose to prove a key is missing.
      !/\.(test|spec)\./.test(entry.name) &&
      SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
    ) {
      out.push(full);
    }
  }
  return out;
}

const USE_TRANSLATION_RE = /useTranslation\(\s*(['"])([^'"]+)\1/;
// Captures the key (group 2) and, if present, a same-call single-level
// `{ ... }` options object (group 3) to look for `ns: '...'` in. Doesn't
// handle an options object containing its own nested braces — none of
// this repo's real `t()` calls do (see the file header's known blind
// spots).
const T_CALL_RE = /\bt\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1(?:\s*,\s*(\{[^}]*\}))?/g;
const NS_OPTION_RE = /\bns\s*:\s*(['"])([^'"]+)\1/;
// i18next only resolves `someKey_one`/`someKey_other` when the call site
// actually passes `count` — a bare `t('someKey')` looks for the exact,
// unsuffixed key and does not fall back to a plural form. PLURAL_SUFFIXES
// matching below is gated on this so a call site missing `count` can still
// be caught as genuinely unresolved, rather than incorrectly "matching" a
// plural-only key it could never actually resolve at runtime.
// `count` must be an option key (`{ count: n }` or the shorthand `{ count }`),
// not a value such as `{ context: count }`.
const COUNT_OPTION_RE = /[{,]\s*count\s*[:,}]/;

/** Every `t('key'[, options])` call site found under `sourceDirs`, with
 * its resolved namespace and whether the call passed a `count` option. */
function extractCallSites(sourceDirs) {
  const sites = [];
  for (const dir of sourceDirs) {
    for (const file of walkFiles(dir)) {
      const content = readFileSync(file, 'utf8');
      const fileNamespace = USE_TRANSLATION_RE.exec(content)?.[2] ?? DEFAULT_NAMESPACE;

      for (const match of content.matchAll(T_CALL_RE)) {
        const key = match[2];
        const optionsText = match[3];
        const ns = (optionsText && NS_OPTION_RE.exec(optionsText)?.[2]) || fileNamespace;
        const hasCount = Boolean(optionsText && COUNT_OPTION_RE.test(optionsText));
        sites.push({ file, key, ns, hasCount });
      }
    }
  }
  return sites;
}

function relativeTo(root, path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}

/**
 * Runs all three checks against `localesDir`/`sourceDirs` and returns the
 * results — no I/O beyond reading those inputs, no `console`/`process`
 * side effects, so a test can assert on the return value directly. `main()`
 * below is the only caller that turns this into exit-code/stdout behaviour.
 */
export function runCheck({ localesDir, sourceDirs, displayRoot = localesDir }) {
  const namespaces = loadNamespaces(localesDir);
  const errors = [];

  // 1. Locale parity, per namespace.
  for (const [ns, byLocale] of namespaces) {
    const locales = [...byLocale.keys()];
    for (let i = 0; i < locales.length; i++) {
      for (let j = i + 1; j < locales.length; j++) {
        const [localeA, localeB] = [locales[i], locales[j]];
        const keysA = byLocale.get(localeA);
        const keysB = byLocale.get(localeB);
        for (const key of keysA) {
          if (!keysB.has(key)) {
            errors.push(`[${ns}] "${key}" exists in ${localeA} but is missing from ${localeB}.`);
          }
        }
        for (const key of keysB) {
          if (!keysA.has(key)) {
            errors.push(`[${ns}] "${key}" exists in ${localeB} but is missing from ${localeA}.`);
          }
        }
      }
    }
  }

  // 2. Every t() call site resolves to a real key in at least one locale.
  const callSites = extractCallSites(sourceDirs);
  const referenced = new Set(); // `${ns} ${key}`, for the unused-key report below.
  // `${ns} ${key}`, only for calls that passed `count` — the sole case a
  // plural-suffixed locale key (`key_one`/`key_other`) counts as used.
  const pluralReferenced = new Set();

  for (const { file, key, ns, hasCount } of callSites) {
    referenced.add(`${ns} ${key}`);
    if (hasCount) pluralReferenced.add(`${ns} ${key}`);

    const byLocale = namespaces.get(ns);
    if (!byLocale) {
      errors.push(
        `${relativeTo(displayRoot, file)}: t("${key}") uses namespace "${ns}", which has no locale files.`,
      );
      continue;
    }
    const existsSomewhere = [...byLocale.values()].some(
      (keys) =>
        keys.has(key) ||
        (hasCount && PLURAL_SUFFIXES.some((suffix) => keys.has(`${key}_${suffix}`))),
    );
    if (!existsSomewhere) {
      errors.push(
        `${relativeTo(displayRoot, file)}: t("${key}") has no matching key in namespace "${ns}" (any locale).`,
      );
    }
  }

  // 3. Unused keys — reported, never fails the build.
  const unused = [];
  for (const [ns, byLocale] of namespaces) {
    const allKeys = new Set();
    for (const keys of byLocale.values()) {
      for (const key of keys) allKeys.add(key);
    }
    for (const key of allKeys) {
      const base = stripPluralSuffix(key);
      const isPluralForm = base !== key;
      const used =
        referenced.has(`${ns} ${key}`) || (isPluralForm && pluralReferenced.has(`${ns} ${base}`));
      if (!used) {
        unused.push(`[${ns}] ${key}`);
      }
    }
  }

  return { errors: errors.sort(), unused: unused.sort() };
}

function main() {
  const localesDir = join(pkgRoot, 'src/i18n/locales');
  // Source trees this repo actually ships `t()` calls from — the SPA plus
  // the package it imports `t`/`useTranslation` through.
  const sourceDirs = ['src', join('..', 'client-admin', 'src')].map((dir) => join(pkgRoot, dir));

  const { errors, unused } = runCheck({ localesDir, sourceDirs, displayRoot: repoRoot });

  if (errors.length > 0) {
    console.error(`check:i18n found ${errors.length} problem(s):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('check:i18n: every key has a match in every locale, every t() call resolves.');
  }

  if (unused.length > 0) {
    console.log(
      `\ncheck:i18n: ${unused.length} unused key(s) (not a failure — cleanup candidates):`,
    );
    for (const entry of unused) console.log(`  - ${entry}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
