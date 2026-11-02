// @vitest-environment node
/**
 * [Epic 44 / #2562] Help guard (E6, E22): ids in code, ids in the guide and field keys in i18n
 * must agree. Strict both ways since 44.3.12 (#2573): an unknown helpId in code fails, and a
 * declared id that no code uses fails unless HELP_UNWIRED lists it with an issue number. Page ids
 * are wired by PageHeader from the route (E15) and `widget.<key>` ids by WidgetSlot (E23), so
 * those two kinds are checked another way.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readMeta } from './guide-gen/help-index';
import { HELP_GAPS, HELP_INDEX } from './help-index.gen';
import { HELP_UNWIRED, PUBLIC } from './help-unwired';

/** Guide pages whose feature id is not in their own helpIds yet; shrink, never grow. */
const NO_PAGE_ENTRY_YET = new Set<string>();

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const features = JSON.parse(
  readFileSync(path.join(ROOT, 'docs/user-guide/_generated/features.json'), 'utf8'),
) as { id: string }[];
const featureIds = new Set(features.map((f) => f.id));
/** E11: the pages with no shell, so no (?) by design. Only their ids may use the PUBLIC reason. */
const PUBLIC_PAGES = ['start.signIn', 'admin.createSchool'];
const isPublicId = (id: string) => PUBLIC_PAGES.some((p) => id === p || id.startsWith(`${p}.`));
/** `<feature>`, `<feature>.action|field|section.<name>` or `widget.<key>` (25-user-guide). */
const inGrammar = (id: string) => {
  if (featureIds.has(id) || /^widget\.[a-z0-9-]+$/.test(id)) return true;
  const m = id.match(/^(.+)\.(action|field|section)\.[A-Za-z0-9]+$/);
  return !!m && featureIds.has(m[1]!);
};
const SOURCE_DIRS = ['client-admin/src', 'ui/src'];
// ponytail: literals only; a helpId built from a variable is not seen (spread props, ternaries),
// and a literal inside a comment counts as used. Strip comments if that ever hides a dead id.
const SKIP = /\.(test|stories|gen)\.tsx?$|\.d\.ts$|help-hint\.tsx$/;
// `helpId` or a prefixed slot prop such as DataTable's `expandHelpId`.
const LITERAL = /\b(?:helpId|[a-z]\w*HelpId)(?:=\{?\s*["']|:\s*["'])([^"']+)["']/g;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === 'node_modules'
        ? []
        : walk(path.join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !SKIP.test(e.name)
        ? [path.join(dir, e.name)]
        : [],
  );

const literalsIn = (src: string): string[] => [...src.matchAll(LITERAL)].map((m) => m[1]!);
const unknownIn = (src: string, index: Record<string, unknown>): string[] =>
  literalsIn(src).filter((id) => !Object.hasOwn(index, id));

const codeIds = SOURCE_DIRS.flatMap((d) => walk(path.join(ROOT, d))).flatMap((f) =>
  literalsIn(readFileSync(f, 'utf8')),
);
/** The id a HELP_GAPS message names, without any `#anchor` suffix. */
const gapId = (g: string) => g.match(/"([^"#]+)/)![1]!;
const gapIds = HELP_GAPS.map(gapId);
const gapMentions = (id: string) => gapIds.includes(id);

/**
 * Every HELP_GAPS message (an id the guide declares but the generator cannot index: field help
 * missing, id declared on more than one page, bad anchor), as of 44.1.02. Whole messages, not
 * ids, so one more or one fewer declaration of an already-listed id also fails. Shrink-only: a
 * new gap or a fixed one fails until this list matches.
 */
const KNOWN_GAPS: string[] = [];

/** Pages with knownIssues but no id="known-issues" section in bn or en (guide gap). Shrink-only. */
const NO_KNOWN_ISSUES_SECTION_YET = new Set<string>();

/** Index entries whose default anchor (E10) is not an id="" on the bn or en page. Shrink-only. */
const KNOWN_ANCHOR_GAPS: string[] = [];

/** `id="x"` but not `data-id="x"`. */
const declaresId = (text: string, anchor: string) =>
  [...text.matchAll(/(?<![\w-])id="([^"]+)"/g)].some((m) => m[1] === anchor);
const hasAnchor = (lang: string, pagePath: string, anchor: string) =>
  declaresId(
    readFileSync(path.join(ROOT, 'docs/user-guide', lang, `${pagePath}.md`), 'utf8'),
    anchor,
  );

describe('help guard', () => {
  it('HELP_GAPS equals the checked-in baseline (shrink-only)', () => {
    expect([...HELP_GAPS].sort()).toEqual([...KNOWN_GAPS].sort());
  });

  it('every entry anchor exists on the bn and en page, bar the baseline', () => {
    const bad = Object.entries(HELP_INDEX)
      .filter(
        ([, e]) =>
          e.anchor && !(['bn', 'en'] as const).every((l) => hasAnchor(l, e.path, e.anchor)),
      )
      .map(([id]) => id);
    expect(bad.sort()).toEqual([...KNOWN_ANCHOR_GAPS].sort());
  });

  it('NO_PAGE_ENTRY_YET only holds ids that are still missing (shrink-only)', () => {
    expect([...NO_PAGE_ENTRY_YET].filter((id) => Object.hasOwn(HELP_INDEX, id))).toEqual([]);
  });

  it('a page with knownIssues has id="known-issues" in bn and en, bar the baseline', () => {
    const paths = new Set(
      Object.values(HELP_INDEX)
        .filter((e) => e.knownIssues > 0)
        .map((e) => e.path),
    );
    const offenders = [...paths].filter(
      (p) => !(['bn', 'en'] as const).every((l) => hasAnchor(l, p, 'known-issues')),
    );
    // Equality both ways: a new offender fails, and a fixed one fails until it leaves the list.
    expect(offenders.sort()).toEqual([...NO_KNOWN_ISSUES_SECTION_YET].sort());
  });

  it('the TS guide:meta reader agrees with guide:check (frontmatter.mjs) on every page', async () => {
    const fm = (await import(
      pathToFileURL(path.join(ROOT, 'scripts/user-guide/frontmatter.mjs')).href
    )) as {
      readPage: (file: string) => {
        fm: { helpIds?: unknown[]; title?: string; summary?: string; knownIssues?: unknown } | null;
      };
      listPages: (lang: string, root: string) => string[];
    };
    const diffs: string[] = [];
    for (const lang of ['bn', 'en'])
      for (const rel of fm.listPages(lang, ROOT)) {
        const file = path.join(ROOT, 'docs/user-guide', lang, rel);
        const js = fm.readPage(file).fm;
        if (!js) continue;
        const ts = readMeta(file);
        const want = {
          helpIds: (js.helpIds ?? []).map(String),
          title: js.title ?? '',
          summary: js.summary ?? '',
          knownIssues: Array.isArray(js.knownIssues) ? js.knownIssues.length : 0,
        };
        const got = {
          helpIds: ts.helpIds,
          title: ts.title,
          summary: ts.summary,
          knownIssues: ts.knownIssues,
        };
        if (JSON.stringify(got) !== JSON.stringify(want))
          diffs.push(`${lang}/${rel}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
      }
    expect(diffs).toEqual([]);
  });

  it('NO_PAGE_ENTRY_YET only holds ids still in features.json', () => {
    expect([...NO_PAGE_ENTRY_YET].filter((id) => !features.some((f) => f.id === id))).toEqual([]);
  });

  it('an anchor is an id="", not a data-id=""', () => {
    expect(declaresId('<a id="x"></a>', 'x')).toBe(true);
    expect(declaresId('<p data-id="x"></p>', 'x')).toBe(false);
    expect(declaresId('<a id="xy"></a>', 'x')).toBe(false);
  });

  it('every helpId literal in code is in HELP_INDEX', () => {
    expect(codeIds.filter((id) => !Object.hasOwn(HELP_INDEX, id))).toEqual([]);
  });

  it('flags an unknown literal in each supported form', () => {
    expect(unknownIn('<PageHeader helpId="nope.page" />', HELP_INDEX)).toEqual(['nope.page']);
    expect(unknownIn("<FormField helpId={'nope.field'} />", HELP_INDEX)).toEqual(['nope.field']);
    expect(unknownIn("const a = { helpId: 'nope.action' }", HELP_INDEX)).toEqual(['nope.action']);
    expect(unknownIn('<DataTable expandHelpId="nope.expand" />', HELP_INDEX)).toEqual([
      'nope.expand',
    ]);
    expect(
      unknownIn('<PageHeader helpId="students.students" />', { 'students.students': {} }),
    ).toEqual([]);
  });

  it('every features.json id is a page entry in HELP_INDEX', () => {
    expect(
      features
        .map((f) => f.id)
        .filter((id) => !Object.hasOwn(HELP_INDEX, id) && !NO_PAGE_ENTRY_YET.has(id)),
    ).toEqual([]);
  });

  it('every .field. id has non-blank help.<key> in bn and en of its namespace', () => {
    const missing: string[] = [];
    for (const [id, e] of Object.entries(HELP_INDEX)) {
      if (!id.includes('.field.')) continue;
      for (const lang of ['bn', 'en']) {
        if (!e.field) {
          missing.push(`${lang}:${id}`);
          continue;
        }
        const file = path.join(ROOT, `ui/src/i18n/locales/${lang}/${e.field.ns}.json`);
        const help = JSON.parse(readFileSync(file, 'utf8')).help as Record<string, unknown>;
        const text = help?.[e.field.key];
        if (typeof text !== 'string' || !text.trim()) missing.push(`${lang}:${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every HELP_UNWIRED id is in the guide and not used in code', () => {
    const notInGuide = Object.keys(HELP_UNWIRED).filter(
      (id) => !Object.hasOwn(HELP_INDEX, id) && !gapMentions(id),
    );
    expect(notInGuide).toEqual([]);
    expect(codeIds.filter((id) => Object.hasOwn(HELP_UNWIRED, id))).toEqual([]);
  });

  it('every HELP_UNWIRED reason names an issue (#n: …), or is E11 on a public page id', () => {
    expect(
      Object.entries(HELP_UNWIRED)
        .filter(([id, why]) => (why === PUBLIC ? !isPublicId(id) : !/^#\d+: \S/.test(why)))
        .map(([id]) => id),
    ).toEqual([]);
  });

  it('every declared id that is not a page or widget id is used in code or in HELP_UNWIRED', () => {
    // HELP_GAPS ids are declared too, just not indexable: they need a HELP_UNWIRED line as well.
    const declared = new Set([...Object.keys(HELP_INDEX), ...gapIds]);
    const unused = [...declared].filter(
      (id) =>
        !featureIds.has(id) &&
        !id.startsWith('widget.') &&
        !codeIds.includes(id) &&
        !Object.hasOwn(HELP_UNWIRED, id),
    );
    expect(unused).toEqual([]);
  });

  it('every HELP_INDEX id follows the helpId grammar', () => {
    expect(Object.keys(HELP_INDEX).filter((id) => !inGrammar(id))).toEqual([]);
    expect(inGrammar('attendance.attendance.action.submit')).toBe(true);
    expect(inGrammar('widget.attendance-today')).toBe(true);
    expect(inGrammar('administration.settings.logo')).toBe(false);
    expect(inGrammar('nope.page.action.x')).toBe(false);
  });

  it('widget.<key> ids match the widget files one to one (WidgetSlot wires them, E23)', () => {
    // Same rule as widgets/registry.ts: the key is the `<key>.widget.tsx` file name.
    const dir = path.join(ROOT, 'client-admin/src/dashboard/widgets');
    const keys = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      // `./*/*.widget.tsx`: exactly one folder deep, like the registry glob.
      .filter((f) => f.endsWith('.widget.tsx') && f.split(path.sep).length === 2)
      .map((f) => `widget.${path.basename(f, '.widget.tsx')}`)
      .sort();
    const declared = Object.keys(HELP_INDEX)
      .filter((id) => id.startsWith('widget.'))
      .sort();
    expect(keys.length).toBeGreaterThan(0);
    expect(declared).toEqual(keys);
  });
});
