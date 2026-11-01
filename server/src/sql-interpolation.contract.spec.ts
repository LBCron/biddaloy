import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Contract test [75.15]: no `${...}` inside a template literal that is passed
 * straight to a query method (`.query(`, `.query<T>(`, `.where(`, `.andWhere(`,
 * `.orderBy(`, `.distinctOn(`, the condition argument of `.leftJoin(` ...),
 * unless the file lists that exact expression below.
 *
 * Why: a `${userInput}` in SQL is injection. User values must be bound as
 * `:param` (query builder) or `$n` (raw `.query`).
 *
 * Fixing a failure:
 *   - value comes from a request  -> bind it as a :param / $n. Never allowlist it.
 *   - value is a code constant / whitelisted identifier -> add the expression to
 *     REVIEWED_INTERPOLATIONS for that file, with a one-line reason.
 *
 * Known blind spots (not caught):
 *   - SQL built into a variable first: `const sql = \`...${x}...\`; qb.query(sql)`
 *   - a ternary or string concatenation as the first argument
 *   - `select([...])` / `groupBy([...])` arrays holding templates
 *   - `.set({ col: () => \`${x}\` })` function values
 *   - wrapper helpers (`run(...)`, `one(...)`, `q(...)`) around a query call
 *   - anything after a nested backtick inside a template (the match stops there)
 * ponytail: direct-argument guard only; a lint rule or SQL tag function if
 * string-built SQL keeps slipping through.
 *
 * Skips `*.spec.ts`, `*.e2e-spec.ts` and `src/migrations/**` (fixed DDL text).
 */
const QUERY_METHODS =
  'query|where|andWhere|orWhere|having|andHaving|orHaving|orderBy|addOrderBy|select|addSelect|innerJoin|leftJoin|innerJoinAndSelect|leftJoinAndSelect|from|groupBy|addGroupBy|distinctOn';
// optional generic, e.g. `.query<Row[]>(`
const GENERIC = '(?:<[^>()]*>)?';
// \x60 is a backtick. First argument is a template literal:
const FIRST_ARG = new RegExp(
  '\\.(?:' + QUERY_METHODS + ')' + GENERIC + '\\(\\s*(\x60[^\x60]*\x60)',
  'g',
);
// Join condition: template after 1-3 leading string/identifier args.
const JOIN_COND = new RegExp(
  '\\.(?:innerJoin|leftJoin)(?:AndSelect|AndMapOne|AndMapMany)?' +
    GENERIC +
    '\\((?:\\s*(?:\'[^\'\x60]*\'|"[^"\x60]*"|[\\w.]+)\\s*,){1,3}\\s*(\x60[^\x60]*\x60)',
  'g',
);

/** Per file (path relative to server/src): the sorted `${...}` expressions that
 * appear in direct query arguments. Audited 2026-10-13: none is request input. */
const REVIEWED_INTERPOLATIONS: Record<string, string[]> = {
  // table/column are code constants (JSDoc: constants only; callers pass literals)
  'common/utils/next-serial.util.ts': ['column', 'column', 'column', 'table'],
  // column/relation names and join aliases read from TypeORM entity metadata (#2703 M4)
  'common/utils/live-dependents.ts': [
    'fk',
    'i',
    'other.propertyName',
    'pk',
    'rel.joinColumns[0].databaseName',
  ],
  // SCHOOL_TZ / STALE_DAYS constants
  'modules/applications/application-reports.service.ts': ['SCHOOL_TZ', 'SCHOOL_TZ', 'STALE_DAYS'],
  // SCHOOL_TZ-based fragment, serialClause with :params, constant IN (:...linked) toggle
  'modules/applications/applications.service.ts': [
    'createdOn',
    'createdOn',
    "linked.length > 0 ? 'OR a.subject_student_id IN (:...linked)' : ''",
    'serialClause',
  ],
  // constant column/from/order fragments; where/page/order built from $n placeholders (arg() pushes to params)
  'modules/attention/api/attention-query.service.ts': [
    'BY_SEVERITY',
    'BY_SEVERITY',
    'ITEM_COLS',
    'ITEM_COLS',
    'ITEM_COLS',
    'ITEM_FROM',
    'ITEM_FROM',
    'ITEM_FROM',
    'order',
    'page',
    'where',
    'where',
    'where',
    'where',
  ],
  // where joined from fixed fragments; values bound as $n (params.push)
  'modules/attention/report/alerts-report.service.ts': ['cur.where', 'cur.where', 'prev.where'],
  // priorYearStartSql helper with a fixed placeholder, plus a constant ternary fragment
  'modules/attention/rules/exams/exams-marks-overdue.rule.ts': ["priorYearStartSql('$1')"],
  // dueSql constant
  'modules/attention/rules/family/family-data.ts': ['dueSql'],
  // constant scoped/unscoped fragment; class ids bound as $4 array
  'modules/calendar/calendar-events.service.ts': ['sectionScope'],
  // constant classScopeExists / noClassScope fragments
  'modules/calendar/calendar-visibility.util.ts': [
    'classScopeExists',
    'classScopeExists',
    'noClassScope',
    'noClassScope',
  ],
  // scoped() returns constant fragments
  'modules/calendar/school-calendar.service.ts': [
    "scoped(' AND ec.class_id = :classId')",
    'scoped()',
    'scoped()',
  ],
  // column typed 'class_id' | 'section_id'
  'modules/classes/classes.service.ts': ['column'],
  // priorYearStartSql helper with a fixed placeholder; [75.6] TEACHER_ROWS_FROM_SQL is a
  // module constant FROM/WHERE fragment, tenant and user bound as $1/$2
  'modules/classes/teacher-scope.service.ts': [
    'TEACHER_ROWS_FROM_SQL',
    'TEACHER_ROWS_FROM_SQL',
    'TEACHER_ROWS_FROM_SQL',
    "priorYearStartSql(':tenantId')",
  ],
  // guarded 10k load seed (throwaway DB only): t is a table name from a module-local constant list
  'scripts/load/seed-load-10k.ts': ['t'],
  // dayRecords: rollYearFilter is a fixed SQL fragment chosen by whether a year was given; the year is bound as :yearId
  'modules/attendance/attendance-dashboard.service.ts': ['rollYearFilter'],
  // BN_COLLATION constant (batch names; [97.4.02] message-log sender names)
  'modules/communications/reminders.service.ts': ['BN_COLLATION', 'BN_COLLATION'],
  // lockBills: k is a key of Partial<StudentFee> from internal callers, i is the loop index; values bound as :v<i>
  'modules/fees/fee-generation-batch.service.ts': ['i', 'k'],
  // getAgeing: bal/age are module-local SQL constants (the date is bound as :today); inner is a query builder whose params are copied over
  'modules/fees/fee-dues.service.ts': [
    'age',
    'age',
    'age',
    'bal',
    'bal',
    'bal',
    'inner.getQuery()',
  ],
  // BN_COLLATION constant
  'modules/fees/fees.service.ts': ['BN_COLLATION'],
  // teacher subject terms: i is the forEach index naming :c<i>/:s<i>; values are bound
  'modules/homework/homework.service.ts': ['i', 'i'],
  // ternary between two constant column lists
  'modules/print/exam-documents/exam-documents.service.ts': [
    "bySection ? 'cs.section_name NULLS LAST, r.section_id, r.section_position, r.position' : 'r.position'",
    "bySection ? 'r.section_position' : 'r.position'",
  ],
  // constant SQL fragments; sql/params.length+n are built from $n placeholders, values bound
  'modules/print/jobs/print-history.service.ts': [
    'ID_CARD_WAITING',
    'ID_CARD_WAITING',
    'ID_CARD_WAITING',
    'REGISTER_MAX_ROWS + 1',
    'REGISTER_ORDER',
    'REGISTER_ORDER',
    'REGISTER_SELECT',
    'REGISTER_SELECT',
    'ROW_FROM',
    'ROW_FROM',
    'ROW_FROM',
    'ROW_FROM',
    'ROW_FROM',
    'ROW_FROM',
    'ROW_FROM',
    'ROW_SELECT',
    'ROW_SELECT',
    'ROW_SELECT',
    "acrGate(caller.role, '$3')",
    "acrGate(caller.role, '$3')",
    "acrGate(caller.role, '$4')",
    'params.length + 1',
    'params.length + 1',
    'params.length + 2',
    'params.length + 2',
    "printed('EXAM_ADMIT_CARD', 's.id', 'AND i.context_id = ex.id')",
    'sql',
    'sql',
    'sql',
    'sql',
    'sql',
  ],
  // clause built by buildFilter from fixed fragments with $n placeholders; alias is the literal "p"
  'modules/reports/collections-report.service.ts': ['clause', 'clause'],
  // [58.0.03] actorIsStaffIn: code-constant role list + literal $n / column refs
  'modules/routines/routine-slots.service.ts': ["actorIsStaffIn('$2', 'ft.tenant_id')"],
  'modules/routines/teacher-busy.service.ts': ["actorIsStaffIn('$3', 's.id')"],
  // column is list === 'shifts' ? 'shift' : 'version'
  'modules/schools/schools.service.ts': ['column', 'column'],
  // BN_COLLATION constant
  'modules/students/students.service.ts': ['BN_COLLATION', 'BN_COLLATION'],
  // BN_COLLATION / NOT_SWAPPED_SQL constants
  'modules/users/users.service.ts': ['BN_COLLATION', 'NOT_SWAPPED_SQL'],
  // DEMO: constant `s.slug LIKE 'bmsc-%'` fragment, no input
  'scripts/demo-seed/validator.ts': [
    'DEMO',
    'DEMO',
    'DEMO',
    'DEMO',
    'DEMO',
    'DEMO',
    'DEMO',
    'DEMO',
    'DEMO',
    'DEMO',
  ],
  // dev seed: demoSchools slug list, not request input
  'scripts/seed.ts': ['demoSchools', 'demoSchools'],
};

const SRC_DIR = __dirname;

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) {
      if (relative(SRC_DIR, fullPath) === 'migrations') continue;
      files.push(...collectFiles(fullPath));
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.e2e-spec.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Each `${...}` body in a template, braces balanced and quoted strings skipped,
 * so `${fn({ a: 1 }) + x}` and `${safe('}') + x}` are captured whole (a `[^}]*`
 * capture stopped at the first `}` and could be allowlisted as `fn({ a: 1 `
 * while an unsafe suffix slipped past). An expression cut off by a nested
 * backtick is returned with an `INCOMPLETE:` prefix, so it can never equal a
 * reviewed entry and always has to be looked at. */
function templateExpressions(template: string): string[] {
  const out: string[] = [];
  let i = template.indexOf('${');
  while (i !== -1) {
    let depth = 1;
    let j = i + 2;
    for (; j < template.length && depth > 0 && template[j] !== '`'; j++) {
      const c = template[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === "'" || c === '"') {
        do j++;
        while (j < template.length && (template[j] !== c || template[j - 1] === '\\'));
      }
    }
    const expr = template.slice(i + 2, depth === 0 ? j - 1 : j);
    out.push(depth === 0 ? expr : `INCOMPLETE: ${expr}`);
    i = template.indexOf('${', j);
  }
  return out;
}

/** file -> sorted `${...}` expressions found in direct query arguments. */
function findInterpolations(): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const file of collectFiles(SRC_DIR)) {
    const source = readFileSync(file, 'utf8');
    const exprs: string[] = [];
    for (const re of [FIRST_ARG, JOIN_COND]) {
      for (const m of source.matchAll(re)) {
        for (const e of templateExpressions(m[1])) exprs.push(e.replace(/\s+/g, ' ').trim());
      }
    }
    if (exprs.length > 0) found[relative(SRC_DIR, file)] = exprs.sort();
  }
  return found;
}

describe('SQL interpolation guard', () => {
  it('no file interpolates an expression that is not reviewed', () => {
    const unreviewed: string[] = [];
    for (const [file, exprs] of Object.entries(findInterpolations())) {
      const left = [...(REVIEWED_INTERPOLATIONS[file] ?? [])];
      for (const e of exprs) {
        const i = left.indexOf(e);
        if (i === -1) unreviewed.push(`${file}: \${${e}}`);
        else left.splice(i, 1);
      }
    }
    expect(
      unreviewed,
      'bind the value as a :param / $n, or, if it is a code constant, add a reviewed entry with a reason',
    ).toEqual([]);
  });

  it('captures an expression with braces whole', () => {
    expect(templateExpressions('`a ${fn({ a: 1 }) + userInput} b ${x}`')).toEqual([
      'fn({ a: 1 }) + userInput',
      'x',
    ]);
    expect(templateExpressions("`a ${safe('}') + userInput}`")).toEqual(["safe('}') + userInput"]);
    // Cut off by a nested backtick: never matches a reviewed entry.
    expect(templateExpressions('`a ${cond ? `x` : y}`')).toEqual(['INCOMPLETE: cond ? ']);
  });

  it('no reviewed entry is stale', () => {
    const found = findInterpolations();
    const stale: string[] = [];
    for (const [file, reviewed] of Object.entries(REVIEWED_INTERPOLATIONS)) {
      const left = [...(found[file] ?? [])];
      for (const e of reviewed) {
        const i = left.indexOf(e);
        if (i === -1) stale.push(`${file}: \${${e}} no longer present - remove the entry`);
        else left.splice(i, 1);
      }
    }
    expect(stale).toEqual([]);
  });
});
