// Results island (D9, D10, D36, Rule 22, Rule 23): exam -> class -> section (+ optional roll), a
// Turnstile token, then a paged table whose rows open into per-subject marks. Plain DOM, same
// `/_api/` proxy as the enquiry island. The server's own text is never shown: the status and the
// machine code pick one fixed sentence (copy comes from `data-m-*`, set from i18n).
import { text, type L } from './common';

export interface ResultsExam {
  id: string;
  name: string;
  sections: { id: string; className: string; sectionName: string }[];
}
export interface ResultRow {
  /** Signed pointer for `detail`; the server never sends a result or student id. */
  handle: string;
  roll: number;
  /** null when the school switched names off: the column is then left out. */
  name: string | null;
  gpa: number;
  grade: string;
  passed: boolean;
}
export interface ResultsPage {
  page: number;
  pageSize: number;
  total: number;
  showNames: boolean;
  rows: ResultRow[];
}
export interface SubjectMark {
  name: L;
  obtained: number;
  grade: string;
  passed: boolean;
}
/** Every outcome of a lookup that is not a table. Each has one fixed sentence in `results.*`. */
export type ResultsFailure = 'captcha' | 'invalid' | 'notfound' | 'rate' | 'error';
export interface Query {
  captcha_token: string;
  exam_id: string;
  class_section_id: string;
  roll?: number;
  page?: number;
}

export const classesOf = (e: ResultsExam) => [...new Set(e.sections.map((s) => s.className))];
export const sectionsOf = (e: ResultsExam, className: string) =>
  e.sections.filter((s) => s.className === className);
/**
 * The roll the visitor typed, as a positive whole number. Bangla digits count (০-৯); an empty field
 * means "whole section" (`undefined`); anything else is `null` (refuse, never guess).
 */
export function parseRoll(raw: string): number | undefined | null {
  const v = raw.trim().replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6));
  if (v === '') return undefined;
  return /^[0-9]{1,6}$/.test(v) && Number(v) > 0 ? Number(v) : null;
}
export const pageCount = (p: Pick<ResultsPage, 'total' | 'pageSize'>) =>
  Math.max(1, Math.ceil(p.total / p.pageSize));

const post = (path: string, body: unknown, fetchImpl: typeof fetch) =>
  fetchImpl(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

/** One table lookup. Never throws; the caller shows the sentence for `failure`. */
export async function queryResults(
  body: Query,
  fetchImpl: typeof fetch = fetch,
): Promise<{ page: ResultsPage } | { failure: ResultsFailure }> {
  try {
    const res = await post('/_api/island/results', body, fetchImpl);
    if (res.ok) return { page: (await res.json()) as ResultsPage };
    if (res.status === 400) {
      const j = (await res.json().catch(() => null)) as { details?: { code?: string } } | null;
      return { failure: j?.details?.code === 'CAPTCHA_FAILED' ? 'captcha' : 'invalid' };
    }
    if (res.status === 404) return { failure: 'notfound' };
    if (res.status === 429) return { failure: 'rate' };
    return { failure: 'error' };
  } catch {
    return { failure: 'error' };
  }
}

/** Per-subject marks of one row; `undefined` on any failure. */
export async function loadDetail(
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubjectMark[] | undefined> {
  try {
    const res = await post('/_api/island/results/detail', { handle }, fetchImpl);
    return res.ok ? ((await res.json()) as { subjects: SubjectMark[] }).subjects : undefined;
  } catch {
    return undefined;
  }
}

export interface Labels {
  roll: string;
  name: string;
  gpa: string;
  grade: string;
  result: string;
  pass: string;
  fail: string;
  subjects: string;
  error: string;
  /** Table caption, e.g. the exam name; also the focus target after a lookup. */
  caption?: string;
}

function build<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]>,
  kids: (Node | string)[],
) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

/** The table of one page. Every value goes in as text, never as markup. */
export function renderTable(
  p: ResultsPage,
  l: Labels,
  onOpen: (row: ResultRow, into: HTMLElement) => void,
): HTMLTableElement {
  const cols = [l.roll, ...(p.showNames ? [l.name] : []), l.gpa, l.grade, l.result];
  const head = build(
    'tr',
    {},
    cols.map((c) => build('th', { scope: 'col' }, [c])),
  );
  const body = p.rows.map((r) => {
    const cell = (label: string, v: string) => {
      const td = build('td', {}, [v]);
      td.dataset.l = label;
      return td;
    };
    const detail = build('div', { className: 'subjects' }, []);
    const open = build('details', {}, [build('summary', {}, [String(r.roll)]), detail]);
    open.addEventListener('toggle', () => {
      // Not `hasChildNodes`: a failed load leaves an error line, and the next open must retry.
      if (open.open && !detail.querySelector('ul')) onOpen(r, detail);
    });
    const first = build('td', {}, [open]);
    first.dataset.l = l.roll;
    return build('tr', {}, [
      first,
      ...(p.showNames ? [cell(l.name, r.name ?? '')] : []),
      cell(l.gpa, r.gpa.toFixed(2)),
      cell(l.grade, r.grade),
      cell(l.result, r.passed ? l.pass : l.fail),
    ]);
  });
  const caption = build('caption', { className: 'sr', tabIndex: -1 }, [l.caption ?? l.result]);
  return build('table', { className: 'results-table' }, [
    caption,
    build('thead', {}, [head]),
    build('tbody', {}, body),
  ]);
}

/** The per-subject list that opens under a row. */
export function renderSubjects(marks: SubjectMark[], l: Labels, lang: string): HTMLElement {
  const ul = build(
    'ul',
    {},
    marks.map((m) =>
      build('li', {}, [
        `${text(m.name, lang)}: ${m.obtained} (${m.grade}) ${m.passed ? l.pass : l.fail}`,
      ]),
    ),
  );
  ul.setAttribute('aria-label', l.subjects);
  return ul;
}

// ---- DOM glue: only runs on the page, never when a spec imports the helpers above. ----

interface Turnstile {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  reset(id?: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstile(): Promise<Turnstile | undefined> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => resolve(undefined);
    document.head.append(s);
  });
}

async function init(root: HTMLElement) {
  const lang = root.dataset.lang === 'en' ? 'en' : 'bn';
  const exams = JSON.parse(root.dataset.exams ?? '[]') as ResultsExam[];
  const form = root.querySelector<HTMLFormElement>('form')!;
  const sel = (n: string) => form.elements.namedItem(n) as HTMLSelectElement;
  const [examSel, classSel, sectionSel] = [sel('exam'), sel('class'), sel('section')];
  const rollIn = form.elements.namedItem('roll') as HTMLInputElement;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const out = root.querySelector<HTMLElement>('[data-out]')!;
  const box = root.querySelector<HTMLElement>('[data-captcha]')!;
  const d = root.dataset;
  const labels: Labels = {
    roll: d.lRoll ?? '',
    name: d.lName ?? '',
    gpa: d.lGpa ?? '',
    grade: d.lGrade ?? '',
    result: d.lResult ?? '',
    pass: d.lPass ?? '',
    fail: d.lFail ?? '',
    subjects: d.lSubjects ?? '',
    error: d.mError ?? '',
  };
  const say = (msg: string) => (status.textContent = msg);
  const busy = (on: boolean) => {
    root.toggleAttribute('data-loading', on);
    root.setAttribute('aria-busy', String(on));
  };
  const fill = (s: HTMLSelectElement, items: { value: string; label: string }[]) => {
    s.replaceChildren(
      build('option', { value: '' }, [d.pick ?? '']),
      ...items.map((i) => build('option', { value: i.value }, [i.label])),
    );
    s.disabled = items.length === 0;
  };
  const exam = () => exams.find((e) => e.id === examSel.value);
  examSel.addEventListener('change', () => {
    const e = exam();
    fill(classSel, e ? classesOf(e).map((c) => ({ value: c, label: c })) : []);
    fill(sectionSel, []);
    if (e && classesOf(e).length === 1) {
      classSel.value = classesOf(e)[0];
      classSel.dispatchEvent(new Event('change'));
    }
  });
  classSel.addEventListener('change', () => {
    const e = exam();
    fill(
      sectionSel,
      e && classSel.value
        ? sectionsOf(e, classSel.value).map((s) => ({ value: s.id, label: s.sectionName }))
        : [],
    );
  });
  fill(classSel, []);
  fill(sectionSel, []);

  let token = '';
  let widget: string | undefined;
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const setToken = (t: string) => {
    token = t;
    button.disabled = t === '';
  };
  // First thing, before any await: a click while the Turnstile script is still loading (or is
  // blocked) must never fall through to the browser's own GET submit, which would put the roll in
  // the URL, the history and the access log.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void run(1);
  });
  button.disabled = true;
  const ts = await loadTurnstile();
  const key = d.sitekey ?? '';
  if (ts && key) {
    widget = ts.render(box, {
      sitekey: key,
      callback: (t: string) => setToken(t),
      'expired-callback': () => setToken(''),
      'error-callback': () => setToken(''),
    });
  }
  if (widget === undefined) return say(d.mUnavailable ?? ''); // blocked script: the form stays closed

  async function run(pageNo: number) {
    const class_section_id = sectionSel.value;
    if (!examSel.value || !class_section_id) return;
    if (!token) return say(d.mCaptcha ?? '');
    const roll = parseRoll(rollIn.value);
    if (roll === null) return say(d.mInvalid ?? '');
    say('');
    busy(true);
    const r = await queryResults({
      captcha_token: token,
      exam_id: examSel.value,
      class_section_id,
      ...(roll !== undefined ? { roll } : {}),
      page: pageNo,
    });
    // A Turnstile token works once: the next lookup (or page) needs a fresh one.
    setToken('');
    ts?.reset(widget);
    busy(false);
    out.replaceChildren();
    if ('failure' in r) return say(d[`m${r.failure[0].toUpperCase()}${r.failure.slice(1)}`] ?? '');
    if (r.page.rows.length === 0) return say(d.mEmpty ?? '');
    const table = renderTable(r.page, { ...labels, caption: exam()?.name }, async (row, into) => {
      const marks = await loadDetail(row.handle);
      into.replaceChildren(marks ? renderSubjects(marks, labels, lang) : labels.error);
    });
    out.append(table);
    // One polite announcement in the status line, then focus moves to the table.
    say((d.mCount ?? '').replace('{n}', String(r.page.total)));
    table.querySelector('caption')?.focus();
    const pages = pageCount(r.page);
    if (pages > 1) {
      const go = (n: number, label: string, off: boolean) =>
        build(
          'button',
          {
            type: 'button',
            className: 'btn btn-ghost btn-sm',
            disabled: off,
            onclick: () => void run(n),
          },
          [label],
        );
      out.append(
        build('p', { className: 'pager' }, [
          go(r.page.page - 1, d.prev ?? '', r.page.page <= 1),
          ` ${r.page.page} / ${pages} `,
          go(r.page.page + 1, d.next ?? '', r.page.page >= pages),
        ]),
      );
    }
  }
  root.querySelector('[data-print]')?.addEventListener('click', () => window.print());
}

if (typeof document !== 'undefined') {
  document.querySelectorAll<HTMLElement>('[data-results]').forEach((r) => void init(r));
}
