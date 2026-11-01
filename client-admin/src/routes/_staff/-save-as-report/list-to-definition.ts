/**
 * [8.15.52] Turns what a list screen shows (its filters and visible columns) into a report
 * definition, so "keep this as a report" is two clicks. Pure: no hooks, no i18n, no network.
 *
 * ```
 *  students list                     report definition (STUDENTS area)
 *  class_id=…  (id)       ───────►   filter  class = "Class 8"      (names, not ids)
 *  gender=FEMALE          ───────►   filter  gender = FEMALE
 *  columns: roll, name…   ───────►   dimensions [roll, name, …]
 *  (current academic year)───────►   prompt  academic_year           (asked when running)
 * ```
 *
 * What does not carry over is returned, never dropped silently: `unmappedFilters` and
 * `unmappedColumns` are keys of `common.json` `saveAsReport.parts.*`; the dialog prints them in
 * plain words ("This filter will not go into the report: …").
 *
 * Two things the registry forces (server/src/modules/reports/engine/registry/areas/*.area.ts):
 *
 * - `class`, `section` and `academic_year` are **text** fields, so a list's ids become names.
 * - Money fields are measures, and a measure cannot sit beside a person's name (`name` is not
 *   groupable). So the dues and payments lists become *totals* (per class and section, per day
 *   and method), not one row per student or payment. The student column is reported as unmapped.
 *
 * Answers to "ask when running" prompts use what the prompts component reads: an academic year is
 * the year's **name** (no default, so a run picks the current year and the report never goes
 * stale), a date range is `{ from, to }` (default: what the list showed).
 */
import {
  AggregateFn,
  FilterOp,
  REPORT_DEFINITION_SCHEMA_VERSION,
  ReportLayoutType,
  ReportParamType,
  ReportSubjectArea,
  type ReportDefinitionJson,
  type ReportFilter,
  type ReportParameter,
} from '@biddaloy/shared';

export type ListKind = 'students' | 'dues' | 'payments';

/** A question the saved report can ask each time it runs. */
export interface PromptChoice {
  /** The parameter key in the definition. */
  key: 'academic_year' | 'date_range';
  /** Which words name it: `saveAsReport.prompt.<name>`. */
  name: 'academicYear' | 'dateRange';
  /** What the list showed, which stays fixed when the question is switched off. */
  value: string | { from: string; to: string };
}

export interface ListToDefinitionInput {
  kind: ListKind;
  /** The list's own filters, as its URL holds them (strings; empty means unset). */
  filters: Record<string, string | undefined>;
  /** The names behind `class_id` and `section_id`; the report filters by name. */
  names?: { className?: string | undefined; sectionName?: string | undefined } | undefined;
  /** Column ids showing in the list, in order (see `readVisibleColumns`). */
  columns?: readonly string[] | undefined;
  /** Current academic year name (students). Without it the report has no year filter. */
  academicYear?: string | undefined;
}

export interface ListReportPlan {
  kind: ListKind;
  /** Questions the person may switch on ("ask when running"). Everything else stays fixed. */
  prompts: PromptChoice[];
  /** Keys of `saveAsReport.parts.*`: filters the list has that a report cannot. */
  unmappedFilters: string[];
  /** Keys of `saveAsReport.parts.*`: list columns that have no report field. */
  unmappedColumns: string[];
  /** What the suggested name is made of: the class (and section) and the area. */
  name: {
    scope: string | undefined;
    area: 'students' | 'dues' | 'duesLate' | 'payments';
  };
  /** The definition, with each prompt either asked (`true`) or fixed (`false`). Default: asked. */
  build: (
    ask?: Partial<Record<PromptChoice['key'], boolean>>,
    title?: ReportTitle,
  ) => ReportDefinitionJson;
}

export interface ReportTitle {
  en: string;
  bn: string;
}

// Mirrors the registry's enum lists; the server refuses a value outside them, so anything else
// is reported as unmapped instead of failing the save.
const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'GRADUATED'];
const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const OPEN_BILL_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];
const DUES_STATUSES = ['PENDING', 'PARTIALLY_PAID'];
const FEE_TYPES = [
  'MONTHLY_TUITION',
  'EXAM_FEE',
  'LIBRARY_FEE',
  'LAB_FEE',
  'SPORTS_FEE',
  'COMPUTER_FEE',
  'TRANSPORT_FEE',
  'ANNUAL_FEE',
  'ADMISSION_FEE',
  'OTHER',
  'LATE_FEE',
  'FINE',
];
/** `ageing` buckets for a bill that is open and past its due date. */
const LATE_BUCKETS = ['D0_30', 'D31_60', 'D61_90', 'D90_PLUS'];
const PAYMENT_METHODS = ['CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'BKASH', 'NAGAD', 'ROCKET'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Students list columns that have a report field. */
const STUDENT_COLUMN_FIELDS: Record<string, string[]> = {
  roll: ['roll'],
  registration: ['registration_number'],
  name: ['name'],
  class: ['class', 'section'],
  guardian: ['guardian_name'],
  status: ['status'],
  dateOfBirth: ['birth_date'],
  gender: ['gender'],
};
/** Shown when every column is hidden (or none is known). */
const STUDENT_DEFAULT_COLUMNS = ['name', 'class', 'status'];

/** Dues list columns that become totals. */
const DUES_COLUMN_MEASURES: Record<string, string> = {
  total: 'billed',
  paid: 'paid',
  due: 'outstanding',
};

/** Columns of each list that have no report field at all, as `parts` keys. */
const UNMAPPED_COLUMN_PART: Record<string, string> = {
  address: 'address',
  preferredCommunication: 'preferredCommunication',
  wallet: 'wallet',
  lastReminder: 'lastReminder',
};

function value(filters: ListToDefinitionInput['filters'], key: string): string | undefined {
  const raw = filters[key];
  return raw === undefined || raw === '' ? undefined : raw;
}

function eq(field: string, v: string): ReportFilter {
  return { field, op: FilterOp.EQ, value: v };
}

/** The same word in the cases a person might have typed it: the engine's `=` is case-sensitive. */
function caseVariants(text: string): string[] {
  const capital = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  return [...new Set([text, text.toLowerCase(), capital, text.toUpperCase()])];
}

function dateRangeFilter(field: string, from: string | undefined, to: string | undefined) {
  if (from && to) return { field, op: FilterOp.BETWEEN, value: [from, to] } satisfies ReportFilter;
  if (from) return { field, op: FilterOp.GTE, value: from } satisfies ReportFilter;
  if (to) return { field, op: FilterOp.LTE, value: to } satisfies ReportFilter;
  return undefined;
}

function emptyDefinition(
  subjectArea: ReportDefinitionJson['subjectArea'],
  title: ReportTitle,
): ReportDefinitionJson {
  return {
    schema: REPORT_DEFINITION_SCHEMA_VERSION,
    subjectArea,
    parameters: [],
    dataset: { dimensions: [], measures: [], filters: [], sort: [] },
    layout: { type: ReportLayoutType.TABLE },
    page: { title_en: title.en, title_bn: title.bn, orientation: 'portrait' },
    drill: [],
    calculated: [],
    format: [],
  };
}

const ACADEMIC_YEAR_PARAMETER: ReportParameter = {
  key: 'academic_year',
  type: ReportParamType.ACADEMIC_YEAR,
  label_en: 'Academic year',
  label_bn: 'শিক্ষাবর্ষ',
  // Optional and without a default: a run picks the current year, so the saved report stays current.
  required: false,
};

function dateRangeParameter(range: { from: string; to: string }): ReportParameter {
  return {
    key: 'date_range',
    type: ReportParamType.DATE_RANGE,
    label_en: 'Dates',
    label_bn: 'তারিখ',
    required: false,
    default: { from: range.from, to: range.to },
  };
}

function askOf(
  ask: Partial<Record<PromptChoice['key'], boolean>> | undefined,
  key: PromptChoice['key'],
) {
  return ask?.[key] ?? true;
}

function scopeOf(names: ListToDefinitionInput['names']): string | undefined {
  const parts = [names?.className, names?.sectionName].filter((n): n is string => !!n);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** The class and section filters, by name. A chosen id with no known name goes to `unmapped`. */
function classAndSection(input: ListToDefinitionInput, unmapped: string[]): ReportFilter[] {
  const filters: ReportFilter[] = [];
  if (value(input.filters, 'class_id')) {
    if (input.names?.className) filters.push(eq('class', input.names.className));
    else unmapped.push('class');
  }
  if (value(input.filters, 'section_id')) {
    if (input.names?.sectionName) filters.push(eq('section', input.names.sectionName));
    else unmapped.push('section');
  }
  return filters;
}

function planStudents(input: ListToDefinitionInput): ListReportPlan {
  const { filters } = input;
  const unmappedFilters: string[] = [];
  const unmappedColumns: string[] = [];
  const fixed: ReportFilter[] = [...classAndSection(input, unmappedFilters)];

  const shift = value(filters, 'shift');
  if (shift) fixed.push(eq('shift', shift));
  const version = value(filters, 'version');
  if (version) fixed.push(eq('version', version));
  const status = value(filters, 'enrollment_status');
  if (status) {
    if (STUDENT_STATUSES.includes(status)) fixed.push(eq('status', status));
    else unmappedFilters.push('status');
  }
  const gender = value(filters, 'gender');
  if (gender) {
    if (GENDERS.includes(gender)) fixed.push(eq('gender', gender));
    else unmappedFilters.push('gender');
  }
  const religion = value(filters, 'religion');
  if (religion) {
    fixed.push({ field: 'religion', op: FilterOp.IN, value: caseVariants(religion) });
  }
  const born = dateRangeFilter(
    'birth_date',
    value(filters, 'date_of_birth_from'),
    value(filters, 'date_of_birth_to'),
  );
  if (born) fixed.push(born);
  if (value(filters, 'search')) unmappedFilters.push('search');

  // Columns: the visible ones that have a field, in list order, each field once.
  const fields: string[] = [];
  for (const column of input.columns ?? []) {
    const mapped = STUDENT_COLUMN_FIELDS[column];
    if (mapped) {
      for (const f of mapped) if (!fields.includes(f)) fields.push(f);
    } else if (UNMAPPED_COLUMN_PART[column]) {
      unmappedColumns.push(UNMAPPED_COLUMN_PART[column]);
    }
  }
  const dimensions =
    fields.length > 0 ? fields : STUDENT_DEFAULT_COLUMNS.flatMap((c) => STUDENT_COLUMN_FIELDS[c]!);

  const prompts: PromptChoice[] = input.academicYear
    ? [{ key: 'academic_year', name: 'academicYear', value: input.academicYear }]
    : [];

  return {
    kind: 'students',
    prompts,
    unmappedFilters,
    unmappedColumns,
    name: { scope: scopeOf(input.names), area: 'students' },
    build(ask, title = { en: 'Students', bn: 'শিক্ষার্থী' }) {
      const def = emptyDefinition(ReportSubjectArea.STUDENTS, title);
      const year: ReportFilter[] = [];
      if (input.academicYear) {
        if (askOf(ask, 'academic_year')) {
          def.parameters.push(ACADEMIC_YEAR_PARAMETER);
          year.push({ field: 'academic_year', op: FilterOp.EQ, value: { param: 'academic_year' } });
        } else {
          year.push(eq('academic_year', input.academicYear));
        }
      }
      def.dataset.dimensions = dimensions.map((field) => ({ field }));
      def.dataset.filters = [...year, ...fixed];
      // Class 6 before Class 10 (by number), then section, then roll: how a school reads a list.
      def.dataset.sort = [
        { field: 'class_order', dir: 'asc' },
        { field: 'section', dir: 'asc' },
        { field: 'roll', dir: 'asc' },
      ];
      def.layout = { type: ReportLayoutType.TABLE };
      def.page.orientation = dimensions.length > 6 ? 'landscape' : 'portrait';
      return def;
    },
  };
}

function planDues(input: ListToDefinitionInput): ListReportPlan {
  const { filters } = input;
  const unmappedFilters: string[] = [];
  const unmappedColumns: string[] = [];
  const fixed: ReportFilter[] = [...classAndSection(input, unmappedFilters)];

  const late = value(filters, 'flagged') === 'true';
  const status = value(filters, 'status');
  if (late) {
    fixed.push({ field: 'ageing', op: FilterOp.IN, value: LATE_BUCKETS });
  } else {
    if (status) {
      if (DUES_STATUSES.includes(status)) fixed.push(eq('status', status));
      else unmappedFilters.push('status');
    }
    // The dues screen lists only bills that still owe money; the area also holds paid ones.
    if (!status || !DUES_STATUSES.includes(status)) {
      fixed.push({ field: 'status', op: FilterOp.IN, value: OPEN_BILL_STATUSES });
    }
  }
  const feeType = value(filters, 'fee_type');
  if (feeType) {
    if (FEE_TYPES.includes(feeType)) fixed.push(eq('fee_type', feeType));
    else unmappedFilters.push('feeType');
  }
  // Fee period (month and year of the bill) and the search text have no field in the report.
  if (value(filters, 'month')) unmappedFilters.push('month');
  if (value(filters, 'year')) unmappedFilters.push('year');
  if (value(filters, 'search')) unmappedFilters.push('search');

  // One row per student cannot carry money (see the header), so it becomes totals per class.
  unmappedColumns.push('student');
  const measures: string[] = [];
  let withStatus = false;
  for (const column of input.columns ?? []) {
    const measure = DUES_COLUMN_MEASURES[column];
    if (measure) {
      if (!measures.includes(measure)) measures.push(measure);
    } else if (column === 'status') {
      withStatus = true;
    } else if (UNMAPPED_COLUMN_PART[column]) {
      unmappedColumns.push(UNMAPPED_COLUMN_PART[column]);
    }
  }
  if (measures.length === 0) measures.push('outstanding');

  return {
    kind: 'dues',
    prompts: [],
    unmappedFilters,
    unmappedColumns,
    name: { scope: scopeOf(input.names), area: late ? 'duesLate' : 'dues' },
    build(_ask, title = { en: 'Dues', bn: 'বকেয়া' }) {
      const def = emptyDefinition(ReportSubjectArea.FEES, title);
      const dimensions = ['class', 'section', ...(withStatus ? ['status'] : [])];
      def.dataset.dimensions = dimensions.map((field) => ({ field }));
      def.dataset.measures = measures.map((field) => ({ field, fn: AggregateFn.SUM }));
      def.dataset.filters = fixed;
      def.dataset.sort = dimensions.map((field) => ({ field, dir: 'asc' as const }));
      def.layout = {
        type: ReportLayoutType.GROUPED,
        group_by: ['class'],
        subtotals: true,
        totals: true,
      };
      return def;
    },
  };
}

function planPayments(input: ListToDefinitionInput): ListReportPlan {
  const { filters } = input;
  const unmappedFilters: string[] = [];
  const fixed: ReportFilter[] = [];

  const method = value(filters, 'payment_method');
  if (method) {
    if (PAYMENT_METHODS.includes(method)) fixed.push(eq('method', method));
    else unmappedFilters.push('method');
  }
  const includeReversed = value(filters, 'include_reversed') === 'true';
  if (!includeReversed) {
    // The list hides payments that were later reversed (`reversed_by_payment_id`); the area has no
    // field for that, so the report still counts them. Leaving out the reversal rows themselves
    // changes no total (every money measure skips them) but drops days that hold only reversals.
    fixed.push({ field: 'is_reversal', op: FilterOp.EQ, value: false });
    unmappedFilters.push('reversedHidden');
  }
  if (value(filters, 'search')) unmappedFilters.push('search');

  let from = value(filters, 'date_from');
  let to = value(filters, 'date_to');
  if (from && !ISO_DATE.test(from)) {
    unmappedFilters.push('date');
    from = undefined;
  }
  if (to && !ISO_DATE.test(to)) {
    if (!unmappedFilters.includes('date')) unmappedFilters.push('date');
    to = undefined;
  }
  // A prompt holds a whole range; one open end stays a fixed filter.
  const range = from && to ? { from, to } : undefined;
  const prompts: PromptChoice[] = range
    ? [{ key: 'date_range', name: 'dateRange', value: range }]
    : [];
  const openEnded = !range ? dateRangeFilter('payment_date', from, to) : undefined;

  const measures = includeReversed
    ? ['collected', 'reversed', 'net', 'payments']
    : ['collected', 'payments'];

  return {
    kind: 'payments',
    prompts,
    unmappedFilters,
    // One row per payment cannot carry the amount (see the header): the student and the
    // reference are not in the totals.
    unmappedColumns: ['student', 'reference'],
    name: { scope: undefined, area: 'payments' },
    build(ask, title = { en: 'Payments', bn: 'জমা' }) {
      const def = emptyDefinition(ReportSubjectArea.PAYMENTS, title);
      const dates: ReportFilter[] = [];
      if (range) {
        if (askOf(ask, 'date_range')) {
          def.parameters.push(dateRangeParameter(range));
          dates.push({
            field: 'payment_date',
            op: FilterOp.BETWEEN,
            value: { param: 'date_range' },
          });
        } else {
          dates.push({
            field: 'payment_date',
            op: FilterOp.BETWEEN,
            value: [range.from, range.to],
          });
        }
      } else if (openEnded) {
        dates.push(openEnded);
      }
      def.dataset.dimensions = [{ field: 'payment_date' }, { field: 'method' }];
      def.dataset.measures = measures.map((field) => ({ field, fn: AggregateFn.SUM }));
      def.dataset.filters = [...dates, ...fixed];
      def.dataset.sort = [
        { field: 'payment_date', dir: 'asc' },
        { field: 'method', dir: 'asc' },
      ];
      def.layout = { type: ReportLayoutType.TABLE, totals: true };
      return def;
    },
  };
}

export function planListReport(input: ListToDefinitionInput): ListReportPlan {
  switch (input.kind) {
    case 'students':
      return planStudents(input);
    case 'dues':
      return planDues(input);
    case 'payments':
      return planPayments(input);
  }
}

/**
 * The columns showing in a `DataTable` right now. The table keeps its visibility in
 * `localStorage` under `data-table:<tableId>` (`ui/src/components/data-table.tsx`); a column
 * missing from that record follows the page's own `defaultColumnVisibility`. Never throws:
 * storage can be blocked, so the defaults are the answer then.
 */
export function readVisibleColumns(
  tableId: string,
  allColumns: readonly string[],
  defaults: Record<string, boolean> = {},
): string[] {
  let stored: Record<string, boolean> = {};
  let order: string[] = [];
  try {
    const raw = window.localStorage.getItem(`data-table:${tableId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        columnVisibility?: Record<string, boolean>;
        columnOrder?: string[];
      };
      stored = parsed.columnVisibility ?? {};
      order = Array.isArray(parsed.columnOrder) ? parsed.columnOrder : [];
    }
  } catch {
    // blocked or corrupt storage: fall back to the defaults
  }
  const visible = (id: string) => (stored[id] ?? defaults[id]) !== false;
  const ordered = [
    ...order.filter((id) => allColumns.includes(id)),
    ...allColumns.filter((id) => !order.includes(id)),
  ];
  return ordered.filter(visible);
}
