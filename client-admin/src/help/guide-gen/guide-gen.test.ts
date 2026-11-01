// @vitest-environment node
/**
 * [Epic 42 / #2520] Golden test for `yarn guide:gen`. Without `UPDATE_GUIDE`
 * it fails when a generated guide file on disk is stale (same bidirectional
 * style as `route-manifest.test.ts`); with `UPDATE_GUIDE=1` it rewrites them.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import manifest from '../../../../e2e/route-manifest.json';

import { buildFeatures, unmappedRoutes } from './features';
import { buildFieldTable } from './field-table';
import { buildRoleIndex } from './role-index';
import { generate, slug, writeGenerated } from './write';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const routes = manifest.routes.map((r) => r.path);

describe('generated guide files', () => {
  it(
    process.env.UPDATE_GUIDE ? 'rewrites them (UPDATE_GUIDE=1)' : 'match what is on disk',
    async () => {
      const generated = await generate(
        ROOT,
        process.env.GUIDE_SHA ? { GUIDE_SHA: process.env.GUIDE_SHA } : {},
      );
      if (process.env.UPDATE_GUIDE) {
        writeGenerated(generated);
        return;
      }
      const stale = [...generated.files]
        .filter(([file, text]) => !existsSync(file) || readFileSync(file, 'utf8') !== text)
        .map(([file]) => path.relative(ROOT, file));
      expect(stale, 'run `yarn guide:gen` and commit the result').toEqual([]);
    },
  );

  it('a stale block is rewritten, so the comparison above would fail', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'guide-gen-'));
    for (const f of [
      'package.json',
      'e2e/route-manifest.json',
      ...['bn', 'en'].flatMap((l) =>
        ['staff', 'nav', 'common'].map((n) => `ui/src/i18n/locales/${l}/${n}.json`),
      ),
    ]) {
      mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      cpSync(path.join(ROOT, f), path.join(tmp, f));
    }
    const page = path.join(tmp, 'docs/user-guide/en/roles/teacher.md');
    mkdirSync(path.dirname(page), { recursive: true });
    writeFileSync(
      page,
      '<!-- guide:generated:roles:teacher -->\n\n- stale\n\n<!-- /guide:generated -->\n',
    );
    const generated = await generate(tmp);
    expect(generated.files.get(page)).not.toContain('- stale');
    expect(generated.files.get(page)).toContain('Attendance');
    expect(
      JSON.parse(generated.files.get(path.join(tmp, 'docs/user-guide/_generated/blocks.json'))!).en[
        'roles:teacher'
      ],
    ).toContain('Attendance');
    rmSync(tmp, { recursive: true });
  });
});

describe('route coverage', () => {
  const features = buildFeatures(routes);
  const internal = JSON.parse(
    readFileSync(path.join(ROOT, 'docs/user-guide/route-map.json'), 'utf8'),
  ) as Record<string, string>;

  it('every manifest route is in exactly one feature or one internal entry', () => {
    const counts = new Map<string, number>();
    for (const r of features.flatMap((f) => f.routes)) counts.set(r, (counts.get(r) ?? 0) + 1);
    expect([...counts].filter(([, n]) => n > 1)).toEqual([]);
    expect(unmappedRoutes(features, routes).sort()).toEqual(Object.keys(internal).sort());
    for (const [route, reason] of Object.entries(internal))
      expect(reason, route).toMatch(/^internal: ./);
  });

  it('covers every nav and portal item, with the spec examples', () => {
    expect(features.filter((f) => f.kind === 'portal')).toHaveLength(15);
    expect(features.filter((f) => f.kind === 'nav' || f.id === 'dashboard').length).toBeGreaterThan(
      50,
    );
    const owner = (r: string) => features.find((f) => f.routes.includes(r))?.id;
    expect(owner('/staff/import')).toBe('people.staffImport');
    expect(owner('/attendance/staff/leave')).toBe('attendance.staffAttendance');
    expect(owner('/staff/$userId/acr/$assessmentId')).toBe('people.evaluations');
    expect(owner('/login')).toBe('start.signIn');
    expect(owner('/portal/notifications')).toBe('portal.notifications');
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
    expect(new Set(features.map((f) => f.path)).size).toBe(features.length);
  });
});

describe('buildRoleIndex', () => {
  const features = buildFeatures(routes);
  const locale = (ns: string) =>
    JSON.parse(readFileSync(path.join(ROOT, `ui/src/i18n/locales/en/${ns}.json`), 'utf8'));
  const deps = {
    features,
    nav: locale('nav'),
    common: locale('common'),
    summaries: { 'attendance/attendance': 'Take attendance.' },
  };

  it("a teacher's index omits finance items and links only pages that exist", () => {
    const text = buildRoleIndex('TEACHER', 'en', deps);
    expect(text).not.toMatch(/Fee structures|Invoices|Payments/);
    expect(text).toContain('- [Attendance](../attendance/attendance.md) — Take attendance.');
    expect(text).toContain('- Students (coming soon)');
  });

  it('an accountant sees finance, in sidebar order', () => {
    const text = buildRoleIndex('ACCOUNTANT', 'bn', deps);
    expect(text).toContain('**Finance**');
    expect(text.indexOf('Students')).toBeLessThan(text.indexOf('Finance'));
    expect(text).toContain('(শীঘ্রই আসছে)');
  });
});

describe('buildFieldTable', () => {
  const ns = {
    date: 'Date',
    fields: { late: 'Minutes late' },
    help: { date: 'Which day.', late: 'Only with Late.' },
    helpRequired: { date: 'Yes' },
  };

  it('renders a required marker and defaults to No', () => {
    expect(buildFieldTable(ns, 'en')).toBe(
      [
        '| Field | What to enter | Required? |',
        '| --- | --- | --- |',
        '| Date | Which day. | Yes |',
        '| Minutes late | Only with Late. | No |',
      ].join('\n'),
    );
  });

  it('escapes pipes and backslashes so a cell cannot break the table', () => {
    // A backslash in front of a pipe must not swallow the pipe's escape.
    const row = buildFieldTable({ code: 'A\\|B', help: { code: 'one | two' } }, 'en')!.split(
      '\n',
    )[2];
    expect(row).toBe('| A\\\\\\|B | one \\| two | No |');
  });

  it('is null without help keys and throws on a help key with no label', () => {
    expect(buildFieldTable({ date: 'Date' }, 'bn')).toBeNull();
    expect(() => buildFieldTable({ help: { ghost: 'x' } }, 'en', 'demo')).toThrow(/help\.ghost/);
  });
});

describe('slug', () => {
  it('lower-cases, drops punctuation, keeps Bangla vowel signs', () => {
    expect(slug('For Exam controllers!')).toBe('for-exam-controllers');
    expect(slug('শিক্ষক')).toBe('শিক্ষক');
  });
});
