// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  classesOf,
  loadDetail,
  pageCount,
  queryResults,
  renderTable,
  sectionsOf,
  type Labels,
  type ResultRow,
  type ResultsExam,
  type ResultsPage,
} from './results';

const L: Labels = {
  roll: 'Roll',
  name: 'Name',
  gpa: 'GPA',
  grade: 'Grade',
  result: 'Result',
  pass: 'Pass',
  fail: 'Fail',
  subjects: 'By subject',
  error: 'Error',
};
const exam: ResultsExam = {
  id: 'e1',
  name: 'Term 1',
  sections: [
    { id: 's1', className: 'Six', sectionName: 'A' },
    { id: 's2', className: 'Six', sectionName: 'B' },
    { id: 's3', className: 'Seven', sectionName: 'A' },
  ],
};
const row = (roll: number, name: string | null): ResultRow => ({
  id: `r${roll}`,
  roll,
  name,
  gpa: 4.5,
  grade: 'A',
  passed: true,
});
const page = (rows: ResultRow[], total = rows.length, showNames = true): ResultsPage => ({
  page: 1,
  pageSize: 100,
  total,
  showNames,
  rows,
});
const reply = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const q = { captcha_token: 't', exam_id: 'e1', class_section_id: 's1' };

describe('results island', () => {
  it('select chaining: classes of an exam, then only that class sections', () => {
    expect(classesOf(exam)).toEqual(['Six', 'Seven']);
    expect(sectionsOf(exam, 'Six').map((s) => s.sectionName)).toEqual(['A', 'B']);
    expect(sectionsOf(exam, 'Seven').map((s) => s.id)).toEqual(['s3']);
  });

  it('a lookup sent without a Turnstile token is answered with the captcha sentence', async () => {
    const f = reply(400, { details: { code: 'CAPTCHA_FAILED' } });
    expect(await queryResults({ ...q, captcha_token: '' }, f)).toEqual({ failure: 'captcha' });
  });

  it('maps each status to one fixed failure; the server text is never read', async () => {
    expect(await queryResults(q, reply(400, { message: 'secret' }))).toEqual({
      failure: 'invalid',
    });
    expect(await queryResults(q, reply(404))).toEqual({ failure: 'notfound' });
    expect(await queryResults(q, reply(429))).toEqual({ failure: 'rate' });
    expect(await queryResults(q, reply(503))).toEqual({ failure: 'error' });
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await queryResults(q, down)).toEqual({ failure: 'error' });
  });

  it('posts the filter to the proxy and returns the page', async () => {
    const f = reply(200, page([row(1, 'A')]));
    const r = await queryResults({ ...q, roll: 7 }, f);
    expect('page' in r && r.page.rows).toHaveLength(1);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/_api/island/results');
    expect(JSON.parse(init.body as string)).toMatchObject({ roll: 7, class_section_id: 's1' });
  });

  it('a payload without names has no name column', () => {
    const t = renderTable(page([row(1, null)], 1, false), L, () => {});
    expect([...t.querySelectorAll('th')].map((h) => h.textContent)).toEqual([
      'Roll',
      'GPA',
      'Grade',
      'Result',
    ]);
    expect(t.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('with names: a name column; a name is text, never markup', () => {
    const t = renderTable(page([row(1, '<img src=x onerror=1>')]), L, () => {});
    expect([...t.querySelectorAll('th')].map((h) => h.textContent)).toContain('Name');
    expect(t.querySelector('img')).toBeNull();
    expect(t.textContent).toContain('<img src=x onerror=1>');
  });

  it('a roll filter that hits one row renders one row; 101 rows means a second page', () => {
    expect(renderTable(page([row(7, 'X')]), L, () => {}).querySelectorAll('tbody tr')).toHaveLength(
      1,
    );
    expect(pageCount({ total: 101, pageSize: 100 })).toBe(2);
    expect(pageCount({ total: 100, pageSize: 100 })).toBe(1);
    expect(pageCount({ total: 0, pageSize: 100 })).toBe(1);
  });

  it('opening a row loads its subjects once', () => {
    const open = vi.fn();
    const t = renderTable(page([row(1, 'A')]), L, open);
    const d = t.querySelector('details')!;
    d.open = true;
    d.dispatchEvent(new Event('toggle'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0].id).toBe('r1');
  });

  it('detail: the subjects on success, undefined on any failure', async () => {
    const marks = [{ name: { en: 'Math', bn: 'গণিত' }, obtained: 80, grade: 'A+', passed: true }];
    expect(await loadDetail('e1', 'r1', reply(200, { subjects: marks }))).toEqual(marks);
    expect(await loadDetail('e1', 'r1', reply(404))).toBeUndefined();
  });
});
