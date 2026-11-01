/**
 * [8.15.42] Drill-through: a number in a report opens the list of those people, or another report,
 * with the same choices. Pure: no words, no router. The screen turns the answer into a link.
 *
 * ```
 *  report (Class 6 | Girls | 38)          drill rule on the report
 *        │  the clicked cell's values        { field: 'class',
 *        ▼  { class: 'Class 6', gender: 'FEMALE' }   target: { route: '/students' },
 *  resolveDrill(rules, fields, values, ctx)          pass: { class_id: 'class', gender: 'gender' } }
 *        ▼
 *  { kind: 'student', search: { class_id: '<uuid>', gender: 'FEMALE' } }   ->  /students?class_id=…&gender=FEMALE
 * ```
 *
 * `pass` maps a *target* choice to a *source* field (`ReportDrill` in `@biddaloy/shared`). The
 * ticket wrote `{ on, to: 'report:<key>' | 'student', map }`; the shared type is the contract
 * (`{ field, target: { report } | { route }, pass }`), so `report:<key>` is `{ report: key }` and
 * `student` is `{ route: '/students' }`.
 *
 * A link is never made when it would show the wrong people: a source value the cell does not have
 * (not given, hidden for privacy), a class name with no class behind it, or a report that is not in
 * the catalogue all give `null`, so the cell stays plain text.
 */
import type { ReportDrill } from '@biddaloy/shared';

/** The choices the students list understands, and nothing else (`studentsSearchSchema`). */
export const STUDENT_LIST_PARAMS = [
  'class_id',
  'section_id',
  'gender',
  'religion',
  'shift',
  'version',
  'enrollment_status',
  'search',
] as const;
export type StudentListParam = (typeof STUDENT_LIST_PARAMS)[number];

export type DrillTarget =
  | { kind: 'report'; reportId: string; params: Record<string, string> }
  | { kind: 'student'; search: Partial<Record<StudentListParam, string>> };

/** What the screen knows that the report does not: ids behind names, and who may open what. */
export interface DrillContext {
  /** The catalogue id of a report `key` (`undefined`: not there, or not for this role). */
  reportIdByKey: (key: string) => string | undefined;
  /** The students list filters by id; a report only has the class name. */
  classIdByName?: (name: string) => string | undefined;
  sectionIdByName?: (className: string | undefined, name: string) => string | undefined;
  /** The answers the report was run with; a source field the cell does not have is read from here. */
  params?: Record<string, unknown>;
  /** May this person open that kind of page? Missing means yes. */
  canOpen?: (kind: DrillTarget['kind']) => boolean;
  /** Is this academic year the one the students list shows? The list has no year filter. */
  isCurrentYear?: (name: string) => boolean | undefined;
}

const STUDENT_ROUTES: readonly string[] = ['student', 'students', '/students'];

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** The rule that applies to a cell: the first one whose field is one of the cell's own fields. */
export function drillRuleFor(
  rules: readonly ReportDrill[] | undefined,
  fields: readonly string[],
): ReportDrill | undefined {
  return rules?.find((rule) => fields.includes(rule.field));
}

/**
 * Where a cell goes, or `null` for nowhere. `fields` are the keys that name the cell (its column,
 * or its row and column fields in a table of counts); `values` are the cell's own values by key.
 */
export function resolveDrill(
  rules: readonly ReportDrill[] | undefined,
  fields: readonly string[],
  values: Readonly<Record<string, unknown>>,
  ctx: DrillContext,
): DrillTarget | null {
  const rule = drillRuleFor(rules, fields);
  if (!rule) return null;

  // A source field: what the cell says, else what the report was asked. A cell that has the field
  // but no value (not given, hidden) is a dead end, not "no filter".
  const read = (source: string): string | null | undefined => {
    if (source in values) return scalar(values[source]);
    const asked = ctx.params?.[source];
    return asked === undefined ? undefined : scalar(asked);
  };

  if ('report' in rule.target) {
    const reportId = ctx.reportIdByKey(rule.target.report);
    if (reportId === undefined || ctx.canOpen?.('report') === false) return null;
    const params: Record<string, string> = {};
    for (const [param, source] of Object.entries(rule.pass)) {
      const value = read(source);
      if (value === null) return null;
      if (value !== undefined) params[param] = value;
    }
    return { kind: 'report', reportId, params };
  }

  if (!STUDENT_ROUTES.includes(rule.target.route) || ctx.canOpen?.('student') === false) {
    return null;
  }
  const search: Partial<Record<StudentListParam, string>> = {};
  const className = read('class');
  for (const [param, source] of Object.entries(rule.pass)) {
    const value = read(source);
    if (value === null) return null;
    if (value === undefined) continue;
    if (source === 'academic_year') {
      // The list shows the current year only: a count for another year would not match it.
      if (ctx.isCurrentYear?.(value) === false) return null;
      continue;
    }
    if (!(STUDENT_LIST_PARAMS as readonly string[]).includes(param)) continue;
    const key = param as StudentListParam;
    if (key === 'class_id') {
      const id = ctx.classIdByName?.(value);
      if (id === undefined) return null;
      search.class_id = id;
    } else if (key === 'section_id') {
      const id = ctx.sectionIdByName?.(className ?? undefined, value);
      if (id === undefined) return null;
      search.section_id = id;
    } else {
      search[key] = value;
    }
  }
  return Object.keys(search).length > 0 ? { kind: 'student', search } : null;
}

/**
 * The cell's link as the screen needs it. A renderer asks `resolve` per cell; `href` gives a real
 * address (so "open in a new tab" works), `open` navigates inside the app, `label` is the spoken
 * name ("তালিকা দেখুন: ৬ষ্ঠ শ্রেণি, ছাত্রী (৩৮)").
 */
export interface DrillLinks {
  resolve: (cell: {
    fields: readonly string[];
    values: Record<string, unknown>;
  }) => DrillTarget | null;
  href: (target: DrillTarget) => string;
  open: (target: DrillTarget) => void;
  /** The spoken name: what the cell is about, and the number it shows. */
  label: (what: string, value: string) => string;
}

/** What a renderer needs to make cells clickable: the report's drill rules and how to follow them. */
export interface ReportDrilling {
  rules: readonly ReportDrill[];
  links: DrillLinks;
}

/** The report `p` choices of a drilled-to report, and the students list filters, as one query string. */
export function drillQuery(target: DrillTarget): URLSearchParams {
  const query = new URLSearchParams();
  if (target.kind === 'student') {
    for (const [key, value] of Object.entries(target.search)) query.set(key, value);
  } else if (Object.keys(target.params).length > 0) {
    query.set('p', JSON.stringify(target.params));
  }
  return query;
}
