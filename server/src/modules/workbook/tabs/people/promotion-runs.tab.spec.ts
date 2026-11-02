import { describe, expect, it } from 'vitest';
import { PromotionRunStatus, PlacementAlgorithm } from '@biddaloy/shared';
import { PromotionRun } from '../../../promotions/entities/promotion-run.entity';
import { Class } from '../../../academics/entities/class.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { cellText, toCell } from '../../codec/cell-format';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import { promotionRunsTab, type PromotionRunRow } from './promotion-runs.tab';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SOURCE_CLASS_ID = '99999999-9999-4999-8999-999999999999';
const TARGET_CLASS_ID = '77777777-7777-4777-8777-777777777777';
const SOURCE_YEAR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_YEAR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EXAM_ID_1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EXAM_ID_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function makeSourceYear(): AcademicYear {
  return Object.assign(new AcademicYear(), {
    id: SOURCE_YEAR_ID,
    name: '2026-2027',
    tenant_id: TENANT_ID,
  } satisfies Partial<AcademicYear>);
}

function makeSourceClass(): Class {
  return Object.assign(new Class(), {
    id: SOURCE_CLASS_ID,
    name: 'Class 6',
    academic_year_id: SOURCE_YEAR_ID,
    academic_year: makeSourceYear(),
    shift: null,
    version: null,
    tenant_id: TENANT_ID,
  } satisfies Partial<Class>);
}

function makeRun(overrides: Partial<PromotionRun> = {}): PromotionRun {
  const run = Object.assign(new PromotionRun(), {
    id: RUN_ID,
    source_class_id: SOURCE_CLASS_ID,
    source_class: makeSourceClass(),
    source_academic_year_id: SOURCE_YEAR_ID,
    target_academic_year_id: TARGET_YEAR_ID,
    target_class_id: TARGET_CLASS_ID,
    exam_ids: [EXAM_ID_1, EXAM_ID_2],
    final_result_id: null,
    algorithm: PlacementAlgorithm.BLOCK,
    status: PromotionRunStatus.COMMITTED,
    refreshed_at: new Date('2026-03-01T00:00:00.000Z'),
    committed_at: new Date('2026-03-02T00:00:00.000Z'),
    committed_by_user_id: USER_ID,
    approved_by_user_id: USER_ID,
    override_count: 1,
    created_by_user_id: USER_ID,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<PromotionRun>);
  return run;
}

const KEY_INDEX: Record<string, Record<string, string>> = {
  classes: { 'Class 6|2026-2027||': SOURCE_CLASS_ID, 'Class 7|2027-2028||': TARGET_CLASS_ID },
  academic_years: { '2026-2027': SOURCE_YEAR_ID, '2027-2028': TARGET_YEAR_ID },
  exams: { 'First Term Exam|2026-2027|Class 6|2026-2027||': EXAM_ID_1, 'Second Exam': EXAM_ID_2 },
  users: { 'head@school.test': USER_ID },
};

function exportCtx(): ExportContext {
  return {
    keyOf: (tab: string, id: string) => {
      if (tab === 'classes')
        return id === SOURCE_CLASS_ID ? 'Class 6|2026-2027||' : 'Class 7|2027-2028||';
      if (tab === 'academic_years') return id === SOURCE_YEAR_ID ? '2026-2027' : '2027-2028';
      if (tab === 'exams') {
        return id === EXAM_ID_1 ? 'First Term Exam|2026-2027|Class 6|2026-2027||' : 'Second Exam';
      }
      if (tab === 'users') return 'head@school.test';
      return '';
    },
    // Only USER_ID is in the exported `users` tab; any other id is not.
    tryKeyOf: (tab: string, id: string) =>
      tab === 'users' && id === USER_ID ? 'head@school.test' : null,
  };
}

function importCtx(): ImportContext {
  return {
    tenantId: TENANT_ID,
    ref: (tab: string, key: string) => KEY_INDEX[tab]?.[key],
    warn: () => undefined,
  };
}

function toCells(entity: PromotionRun): Record<string, string> {
  const row = promotionRunsTab.toRow(entity, exportCtx());
  const cells: Record<string, string> = {};
  for (const column of promotionRunsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function fromRowOrThrow(cells: Record<string, string>): PromotionRunRow {
  const result = promotionRunsTab.fromRow(cells, 2, importCtx());
  if ('errors' in result) {
    throw new Error(`Unexpected errors: ${JSON.stringify(result.errors)}`);
  }
  return result.row;
}

describe('promotionRunsTab shape', () => {
  it('declares its dependency and identity shape', () => {
    expect(promotionRunsTab.name).toBe('promotion_runs');
    expect(promotionRunsTab.dependsOn).toEqual(['classes', 'academic_years', 'exams', 'users']);
    expect(promotionRunsTab.naturalKey).toEqual(['id']);
    expect(promotionRunsTab.deleteByAbsence).toBe(true);
  });
});

describe('round-trip', () => {
  it('a final-result run round-trips with an empty exams cell', () => {
    const run = makeRun({ exam_ids: [], final_result_id: EXAM_ID_1 });
    const cells = toCells(run);
    expect(cells.exams).toBe('');
    const row = fromRowOrThrow(cells);
    expect(row.exam_ids).toEqual([]);
    expect(row.final_result_id).toBe(EXAM_ID_1);
  });

  it('refuses a row with both sources, or with neither', () => {
    const both = toCells(makeRun({ final_result_id: EXAM_ID_1 }));
    const neither = toCells(makeRun({ exam_ids: [], final_result_id: null }));
    for (const cells of [both, neither]) {
      const result = promotionRunsTab.fromRow(cells, 2, importCtx());
      expect('errors' in result).toBe(true);
    }
  });

  it('fromRow(toRow(entity)) round-trips exam_ids as a ref-list', () => {
    const run = makeRun();
    const cells = toCells(run);
    expect(cells.exams).toBe('First Term Exam|2026-2027|Class 6|2026-2027||;Second Exam');

    const row = fromRowOrThrow(cells);
    expect(row.exam_ids).toEqual([EXAM_ID_1, EXAM_ID_2]);
    expect(row.source_class_id).toBe(SOURCE_CLASS_ID);
    expect(row.target_class_id).toBe(TARGET_CLASS_ID);
    expect(row.status).toBe(PromotionRunStatus.COMMITTED);
    expect(promotionRunsTab.keyOf(row)).toBe(promotionRunsTab.keyOf(run));
  });

  it('an empty target_class cell round-trips to null (a graduating run, D13)', () => {
    const run = makeRun({ target_class_id: null });
    const cells = toCells(run);
    expect(cells.target_class).toBe('');

    const row = fromRowOrThrow(cells);
    expect(row.target_class_id).toBeNull();
  });

  it('an unresolvable exam key yields a RowError naming the exams column', () => {
    const cells = toCells(makeRun());
    cells.exams = 'Ghost Exam';
    const result = promotionRunsTab.fromRow(cells, 3, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('exams');
  });

  it('an unresolvable source_class key yields a RowError naming that column', () => {
    const cells = toCells(makeRun());
    cells.source_class = 'Nonexistent|1999||';
    const result = promotionRunsTab.fromRow(cells, 4, importCtx());
    expect('errors' in result).toBe(true);
    expect((result as { errors: RowError[] }).errors[0].column).toBe('source_class');
  });
});

describe('user attribution columns (GAP-10)', () => {
  it('exports the user key, not the raw uuid', () => {
    const cells = toCells(makeRun());
    expect(cells.committed_by).toBe('head@school.test');
    expect(cells.approved_by).toBe('head@school.test');
    expect(cells.created_by).toBe('head@school.test');
  });

  it('a known user key resolves to the id', () => {
    const row = fromRowOrThrow(toCells(makeRun()));
    expect(row.approved_by_user_id).toBe(USER_ID);
    expect(row.committed_by_user_id).toBe(USER_ID);
    expect(row.created_by_user_id).toBe(USER_ID);
  });

  it.each(['committed_by', 'approved_by', 'created_by'])(
    'a %s key not in this school users is a row error',
    (column) => {
      const cells = toCells(makeRun());
      cells[column] = 'someone@other-school.test';
      const result = promotionRunsTab.fromRow(cells, 5, importCtx());
      expect('errors' in result).toBe(true);
      expect((result as { errors: RowError[] }).errors[0].column).toBe(column);
    },
  );

  it('a nullable attribution of a user missing from the users tab exports null', () => {
    const cells = toCells(makeRun({ approved_by_user_id: 'deadbeef-0000-4000-8000-000000000000' }));
    expect(cells.approved_by).toBe('');
  });

  // A run created by a departed teacher or a SUPER_ADMIN must not fail the
  // whole export (that would make the school impossible to back up).
  it('created_by of a user missing from the users tab exports null instead of throwing', () => {
    const ctx = exportCtx();
    const base = ctx.keyOf;
    ctx.keyOf = (tab, id) => {
      if (tab === 'users') throw new Error('no key');
      return base(tab, id);
    };
    ctx.tryKeyOf = () => null;
    expect(promotionRunsTab.toRow(makeRun(), ctx).created_by).toBeNull();
  });

  it('a blank created_by imports as null, not a row error', () => {
    const cells = toCells(makeRun());
    cells.created_by = '';
    expect(fromRowOrThrow(cells).created_by_user_id).toBeNull();
  });
});

describe('diffFields', () => {
  it('reports nothing for an unchanged pair', () => {
    const run = makeRun();
    const row: PromotionRunRow = {
      id: run.id,
      source_class_id: run.source_class_id,
      source_academic_year_id: run.source_academic_year_id,
      target_academic_year_id: run.target_academic_year_id,
      target_class_id: run.target_class_id,
      exam_ids: [...run.exam_ids],
      final_result_id: run.final_result_id,
      algorithm: run.algorithm,
      status: run.status,
      refreshed_at: run.refreshed_at.toISOString(),
      committed_at: run.committed_at ? run.committed_at.toISOString() : null,
      committed_by_user_id: run.committed_by_user_id,
      approved_by_user_id: run.approved_by_user_id,
      override_count: run.override_count,
      created_by_user_id: run.created_by_user_id,
      source_class_key: 'Class 6|2026-2027||',
      source_academic_year_key: '2026-2027',
      target_academic_year_key: '2027-2028',
      target_class_key: 'Class 7|2027-2028||',
    };
    expect(promotionRunsTab.diffFields(row, run)).toEqual([]);
  });

  it('reports exactly ["status"] for a status-only change', () => {
    const run = makeRun();
    const row: PromotionRunRow = {
      id: run.id,
      source_class_id: run.source_class_id,
      source_academic_year_id: run.source_academic_year_id,
      target_academic_year_id: run.target_academic_year_id,
      target_class_id: run.target_class_id,
      exam_ids: [...run.exam_ids],
      final_result_id: run.final_result_id,
      algorithm: run.algorithm,
      status: PromotionRunStatus.DRAFT,
      refreshed_at: run.refreshed_at.toISOString(),
      committed_at: run.committed_at ? run.committed_at.toISOString() : null,
      committed_by_user_id: run.committed_by_user_id,
      approved_by_user_id: run.approved_by_user_id,
      override_count: run.override_count,
      created_by_user_id: run.created_by_user_id,
      source_class_key: 'Class 6|2026-2027||',
      source_academic_year_key: '2026-2027',
      target_academic_year_key: '2027-2028',
      target_class_key: 'Class 7|2027-2028||',
    };
    expect(promotionRunsTab.diffFields(row, run)).toEqual(['status']);
  });
});

function makeRow(run: PromotionRun): PromotionRunRow {
  return {
    id: run.id,
    source_class_id: run.source_class_id,
    source_academic_year_id: run.source_academic_year_id,
    target_academic_year_id: run.target_academic_year_id,
    target_class_id: run.target_class_id,
    exam_ids: [...run.exam_ids],
    final_result_id: run.final_result_id,
    algorithm: run.algorithm,
    status: run.status,
    refreshed_at: run.refreshed_at.toISOString(),
    committed_at: run.committed_at ? run.committed_at.toISOString() : null,
    committed_by_user_id: run.committed_by_user_id,
    approved_by_user_id: run.approved_by_user_id,
    override_count: run.override_count,
    created_by_user_id: run.created_by_user_id,
    source_class_key: 'Class 6|2026-2027||',
    source_academic_year_key: '2026-2027',
    target_academic_year_key: '2027-2028',
    target_class_key: 'Class 7|2027-2028||',
  };
}

describe('upsert', () => {
  const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222';

  it(
    'refuses to reuse an id already owned by another tenant, and never touches that row ' +
      '(B1: existing resolves null from a tenant-scoped load even when the id belongs to ' +
      'another tenant — save() on a set primary key would otherwise UPDATE it in place)',
    async () => {
      const row = makeRow(makeRun());
      let saveCalled = false;
      const fakeManager = {
        findOne: async () => makeRun({ tenant_id: OTHER_TENANT_ID }),
        save: async (_entity: unknown, value: PromotionRun) => {
          saveCalled = true;
          return value;
        },
      };

      await expect(
        promotionRunsTab.upsert(row, null, TENANT_ID, fakeManager as never),
      ).rejects.toThrow(/already exists in tenant/);
      expect(saveCalled).toBe(false);
    },
  );

  it('creates normally when the id is unowned (findOne resolves null)', async () => {
    const row = makeRow(makeRun());
    let saved: PromotionRun | undefined;
    const fakeManager = {
      findOne: async () => null,
      save: async (_entity: unknown, value: PromotionRun) => {
        saved = value;
        return value;
      },
    };

    await promotionRunsTab.upsert(row, null, TENANT_ID, fakeManager as never);
    expect(saved?.id).toBe(row.id);
    expect(saved?.tenant_id).toBe(TENANT_ID);
  });
});

describe('null attribution keeps the existing user (export could not name them)', () => {
  it('diffFields ignores a null committed_by/approved_by row against a set existing value', () => {
    const run = makeRun();
    const row = { ...makeRow(run), committed_by_user_id: null, approved_by_user_id: null };
    expect(promotionRunsTab.diffFields(row, run)).toEqual([]);
  });

  it('upsert keeps the existing committed_by/approved_by when the row value is null', async () => {
    const existing = makeRun();
    const row = { ...makeRow(existing), committed_by_user_id: null, approved_by_user_id: null };
    const fakeManager = { save: async (_e: unknown, v: PromotionRun) => v };
    const saved = await promotionRunsTab.upsert(row, existing, TENANT_ID, fakeManager as never);
    expect(saved.committed_by_user_id).toBe(USER_ID);
    expect(saved.approved_by_user_id).toBe(USER_ID);
  });

  it('diffFields and upsert keep the existing created_by when the row value is null', async () => {
    const existing = makeRun();
    const row = { ...makeRow(existing), created_by_user_id: null };
    expect(promotionRunsTab.diffFields(row, existing)).toEqual([]);
    const fakeManager = { save: async (_e: unknown, v: PromotionRun) => v };
    const saved = await promotionRunsTab.upsert(row, existing, TENANT_ID, fakeManager as never);
    expect(saved.created_by_user_id).toBe(USER_ID);
  });

  // created_by is NOT NULL: a new run whose creator the export could not name
  // is attributed to the admin running the restore.
  it('a new run with a null created_by is attributed to the user running the restore', async () => {
    const ACTOR = '33333333-3333-4333-8333-333333333333';
    const row = { ...makeRow(makeRun()), created_by_user_id: null };
    const fakeManager = {
      findOne: async () => null,
      save: async (_e: unknown, v: PromotionRun) => v,
    };
    const saved = await promotionRunsTab.upsert(row, null, TENANT_ID, fakeManager as never, ACTOR);
    expect(saved.created_by_user_id).toBe(ACTOR);
  });
});
