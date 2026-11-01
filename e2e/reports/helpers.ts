// [8.15 wave close] Shared pieces for the reporting-engine specs in this folder
// (runner, system reports, statement, designer, export-all): API fixtures that create and
// retire a school's own report, a class with students of known gender, and small readers for
// the table of counts. Not a spec (no `.spec.ts`), so Playwright never runs it on its own.
import type { APIRequestContext, Locator } from '@playwright/test';
import {
  AggregateFn,
  FilterOp,
  REPORT_DEFINITION_SCHEMA_VERSION,
  ReportLayoutType,
  ReportParamType,
  ReportSubjectArea,
  type ReportDefinitionJson,
  type ReportDrill,
} from '@biddaloy/shared';

import {
  createClassSection,
  currentAcademicYear,
  get,
  post,
  type ApiSession,
  type ClassSectionChain,
} from '../api';
import { t } from '../i18n';
import { escapeRegExp } from '../regex';

/** Short and unique per call, safe inside a report key (lower case letters, digits, dashes). */
export function runSuffix(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
}

// ---- reports through the API -----------------------------------------------------------------

export interface CatalogueEntry {
  id: string;
  key: string;
  name_en: string;
  name_bn: string;
  system_template_key: string | null;
}

/** One report of `GET /reports/catalogue` by its `key` (an admin's catalogue holds every published report). */
export async function catalogueEntry(
  request: APIRequestContext,
  session: ApiSession,
  key: string,
): Promise<CatalogueEntry> {
  const folders = await get<{ folder: string | null; reports: CatalogueEntry[] }[]>(
    request,
    session,
    '/reports/catalogue',
  );
  const entry = folders.flatMap((folder) => folder.reports).find((report) => report.key === key);
  if (!entry) throw new Error(`report "${key}" is not in the admin's catalogue`);
  return entry;
}

/**
 * A school's own report, saved and switched on (draft, then publish). `roles` empty means every role
 * that can open reports; admins always see it. Retire it with `archiveReport` when the spec is done.
 */
export async function createPublishedReport(
  request: APIRequestContext,
  session: ApiSession,
  input: { name: string; definition: ReportDefinitionJson; roles?: string[] },
): Promise<{ id: string; key: string }> {
  const key = `e2e-${runSuffix()}`;
  const created = await post<{ id: string }>(request, session, '/reports/definitions', {
    key,
    name_en: input.name,
    name_bn: input.name,
    visible_roles: input.roles ?? [],
    definition: input.definition,
  });
  await post(request, session, `/reports/definitions/${created.id}/publish`, {});
  return { id: created.id, key };
}

/** Takes the report off every list. Cleanup only: a failure here never fails a spec. */
export async function archiveReport(
  request: APIRequestContext,
  session: ApiSession,
  id: string,
): Promise<void> {
  await post(request, session, `/reports/definitions/${id}/archive`, {}).catch(() => undefined);
}

/**
 * Students of one class, counted by class and gender: the shape every system report is built from
 * (a table of counts with totals, see `student-count-banbeis`). The class is a literal filter, so
 * the answer is this spec's own class whatever else the shared test school holds. `gender` is an
 * optional question, copied from the ready "Student list" report: left unanswered it filters nothing.
 */
export function classByGenderDefinition(
  name: string,
  className: string,
  drill: ReportDrill[] = [],
): ReportDefinitionJson {
  return {
    schema: REPORT_DEFINITION_SCHEMA_VERSION,
    subjectArea: ReportSubjectArea.STUDENTS,
    parameters: [
      {
        key: 'gender',
        type: ReportParamType.ENUM,
        label_en: 'Gender',
        label_bn: 'লিঙ্গ',
        required: false,
        options: [
          { value: 'MALE', label_en: 'Boys', label_bn: 'ছাত্র' },
          { value: 'FEMALE', label_en: 'Girls', label_bn: 'ছাত্রী' },
        ],
      },
    ],
    dataset: {
      dimensions: [{ field: 'class_order' }, { field: 'class' }, { field: 'gender' }],
      measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
      filters: [
        { field: 'status', op: FilterOp.EQ, value: 'ACTIVE' },
        { field: 'class', op: FilterOp.EQ, value: className },
        { field: 'gender', op: FilterOp.EQ, value: { param: 'gender' } },
      ],
      sort: [{ field: 'class_order', dir: 'asc' }],
    },
    layout: {
      type: ReportLayoutType.CROSSTAB,
      rows: ['class'],
      columns: ['gender'],
      cell_measure: 'students',
      totals: true,
    },
    page: { title_en: name, title_bn: name, orientation: 'portrait' },
    drill,
    calculated: [],
    format: [],
  };
}

// ---- students --------------------------------------------------------------------------------

export interface ClassWithStudents {
  chain: ClassSectionChain;
  students: { id: string; name: string; gender: 'MALE' | 'FEMALE' }[];
}

/**
 * A new class and section in the school's current academic year, with one student per entry of
 * `genders`. The current year is what the BANBEIS report asks about by default.
 */
export async function createClassWithStudents(
  request: APIRequestContext,
  session: ApiSession,
  label: string,
  genders: ('MALE' | 'FEMALE')[],
): Promise<ClassWithStudents> {
  const year = await currentAcademicYear(request, session);
  const chain = await createClassSection(request, session, year);
  const students: ClassWithStudents['students'] = [];
  for (const [index, gender] of genders.entries()) {
    const name = `${label} Student ${index + 1}`;
    const created = await post<{ id: string }>(request, session, '/students', {
      full_name: name,
      class_section_id: chain.sectionId,
      gender,
    });
    students.push({ id: created.id, name, gender });
  }
  return { chain, students };
}

// ---- reading numbers off the screen ----------------------------------------------------------

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';

/** `১,২০০` -> `1,200`. */
export function toLatinDigits(text: string): string {
  return text.replace(/[০-৯]/g, (digit) => String(BANGLA_DIGITS.indexOf(digit)));
}

/** Matches exactly `n` (as the whole text), written in Latin or Bangla digits. */
export function countPattern(n: number): RegExp {
  const bangla = String(n).replace(/\d/g, (digit) => BANGLA_DIGITS[Number(digit)]!);
  return new RegExp(`^(${n}|${bangla})$`);
}

/** The first number in `text` (money or a count), whichever digits the screen writes. */
export function numberIn(text: string): number {
  const match = /[\d০-৯][\d০-৯,]*(?:\.[\d০-৯]+)?/.exec(text);
  if (!match) throw new Error(`no number in "${text}"`);
  return Number(toLatinDigits(match[0]).replace(/,/g, ''));
}

/**
 * The words a translated sentence starts with, as a pattern. Translate it with the first
 * placeholder set to `@@` (`t('fees.statement.owedNow', { amount: '@@' })`) and the words before it
 * are what is left.
 */
export function sentenceStart(translated: string): RegExp {
  return new RegExp(`^${escapeRegExp(translated.split('@@')[0]!.trim())}`);
}

// ---- the table of counts ---------------------------------------------------------------------

/** The row of a table of counts for one row label (here a class name). */
export function crosstabRow(scope: Locator, rowLabel: string): Locator {
  return scope
    .getByRole('row')
    .filter({ has: scope.page().getByRole('rowheader', { name: rowLabel, exact: true }) });
}

/** The row's last cell: its "মোট". */
export function rowTotal(scope: Locator, rowLabel: string): Locator {
  return crosstabRow(scope, rowLabel).getByRole('cell').last();
}

/**
 * Every row's heading and last cell (the "মোট" row sits in the table's foot), so a spec can check
 * that the "মোট" row is the sum of the rows above it without knowing what else is in the school.
 */
export async function readTotals(table: Locator): Promise<{ heading: string; total: number }[]> {
  const rows = await table.locator('tbody tr, tfoot tr').evaluateAll((trs) =>
    trs.map((tr) => ({
      heading: tr.querySelector('th')?.textContent?.trim() ?? '',
      last: tr.querySelector('td:last-child')?.textContent ?? '',
    })),
  );
  return rows.map((row) => ({ heading: row.heading, total: numberIn(row.last) }));
}

/** The link a count cell carries when its row's field has a drill rule ("তালিকা দেখুন: <class>, …"). */
export function drillLink(scope: Locator, rowLabel: string): Locator {
  const start = t('reportDesigner.drill.open', { what: '@@', value: '@@' }).split('@@')[0]!;
  return scope.getByRole('link', { name: new RegExp(`^${escapeRegExp(start + rowLabel)}`) });
}

/** The JSON a report puts in `?p=` (the answers to its questions), read from an address. */
export function reportAnswersIn(url: string): Record<string, unknown> {
  const raw = new URL(url).searchParams.get('p');
  return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
}
