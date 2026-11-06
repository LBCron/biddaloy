import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ExamStatus,
  ImportFileErrorCode,
  MarkGridState,
  MarkStatus,
  MarksSheetFileErrorCode,
  MarksSheetRowErrorCode,
} from '@biddaloy/shared';
import { MarksImportService } from './marks-import.service';
import type { ParsedMarksSheet, ParsedSheetRow, RawEntry } from './marks-sheet.parser';
import * as parser from './marks-sheet.parser';

const EXAM = 'e1';
const SEC = 's1';
const SUB = 'sub1';
const T = 't1';
const U = 'u1';
const Q = { section_id: SEC, subject_id: SUB };

function makeGrid(over: Record<string, unknown> = {}) {
  return {
    exam_id: EXAM,
    section_id: SEC,
    subject_id: SUB,
    state: MarkGridState.DRAFT,
    students: [
      { id: 'st1', roll_number: 1, full_name: 'One' },
      { id: 'st2', roll_number: 2, full_name: 'Two' },
    ],
    components: [
      { id: 'c1', name: 'Written', source: 'MANUAL', full_marks: '70.00', sequence: 1 },
      { id: 'c2', name: 'Practical', source: 'MANUAL', full_marks: '30.00', sequence: 2 },
      { id: 'c3', name: 'Att', source: 'DERIVED', full_marks: '5.00', sequence: 3 },
    ],
    cells: [{ student_id: 'st1', component_id: 'c1', value: '45.00', status: 'PRESENT' }],
    ...over,
  };
}

function setup(grid = makeGrid(), examStatus: string = ExamStatus.DRAFT) {
  const examRepo = {
    findOne: vi.fn(async () => ({ id: EXAM, name: 'Mid', status: examStatus })),
    manager: { findOne: vi.fn(async () => null) },
  };
  const gridService = { getGrid: vi.fn(async () => grid) };
  const marksService = { upsertBatch: vi.fn(async (_e, dto) => ({ cells: dto.cells })) };
  const authz = { assertCanWrite: vi.fn(async () => undefined) };
  const staging = {
    stage: vi.fn(async () => ({ stagingId: 'stg', expiresAt: '2030-01-01T00:00:00.000Z' })),
    consume: vi.fn(),
  };
  const svc = new MarksImportService(
    examRepo as never,
    {} as never,
    {} as never,
    gridService as never,
    marksService as never,
    authz as never,
    staging as never,
  );
  return { svc, examRepo, gridService, marksService, authz, staging };
}

function row(
  n: number,
  key: string,
  entries: Record<string, RawEntry>,
  error?: true,
): ParsedSheetRow {
  return {
    rowNumber: n,
    studentKey: key,
    roll: 'RAW-ROLL',
    entries,
    ...(error ? { error: MarksSheetRowErrorCode.DUPLICATE_ROW } : {}),
  };
}

function sheet(rows: ParsedSheetRow[], over: Partial<ParsedMarksSheet> = {}): ParsedMarksSheet {
  return {
    sheetId: `${EXAM}:${SEC}:${SUB}`,
    components: [
      { name: 'Written', fullMarksHeader: 'Written /70' },
      { name: 'Practical', fullMarksHeader: 'Practical /30' },
    ],
    rows,
    ...over,
  };
}

const val = (value: string): RawEntry => ({ kind: 'value', value });
const blank: RawEntry = { kind: 'blank' };

describe('MarksImportService.validate classification', () => {
  it('compares in paisa: 45 against stored 45.00 is unchanged; new, changed, absent, exempt counted', async () => {
    const { svc, staging } = setup();
    const res = await svc.validate(
      EXAM,
      Q,
      sheet([
        row(2, 'st1', { Written: val('45'), Practical: val('12.5') }), // unchanged + new
        row(3, 'st2', { Written: { kind: 'absent' }, Practical: { kind: 'exempt' } }),
      ]),
      T,
      'ADMIN',
      U,
    );
    expect(res.summary).toMatchObject({
      unchanged: 1,
      new: 3,
      changed: 0,
      absent: 1,
      exempt: 1,
      errors: 0,
    });
    expect(res.changes).toHaveLength(3);
    expect(
      res.changes.find((c) => c.component_name === 'Practical' && c.student_id === 'st1')?.new,
    ).toBe('12.50');
    expect(staging.stage).toHaveBeenCalledTimes(1);
    expect(res.staging_id).toBe('stg');
  });

  it('a different value is changed and keeps old/old_status', async () => {
    const { svc } = setup();
    const res = await svc.validate(
      EXAM,
      Q,
      sheet([row(2, 'st1', { Written: val('46') })]),
      T,
      'ADMIN',
      U,
    );
    expect(res.summary.changed).toBe(1);
    expect(res.changes[0]).toMatchObject({ old: '45.00', old_status: 'PRESENT', new: '46.00' });
  });

  it('skips blank cells (neither staged nor unchanged)', async () => {
    const { svc, staging } = setup();
    const res = await svc.validate(
      EXAM,
      Q,
      sheet([row(2, 'st1', { Written: blank, Practical: blank })]),
      T,
      'ADMIN',
      U,
    );
    expect(res.summary).toMatchObject({ unchanged: 0, new: 0, changed: 0 });
    expect(res.staging_id).toBeNull();
    expect(staging.stage).not.toHaveBeenCalled();
  });

  it('70.01 against full 70.00 is ABOVE_FULL_MARKS and not staged; 70 is fine', async () => {
    const { svc } = setup();
    const res = await svc.validate(
      EXAM,
      Q,
      sheet([row(2, 'st1', { Written: val('70.01') }), row(3, 'st2', { Written: val('70') })]),
      T,
      'ADMIN',
      U,
    );
    expect(res.errors).toEqual([
      { row: 2, roll: 1, component_name: 'Written', code: MarksSheetRowErrorCode.ABOVE_FULL_MARKS },
    ]);
    expect(res.changes.map((c) => c.student_id)).toEqual(['st2']);
  });

  it('reports INVALID_VALUE, NOT_IN_SECTION (foreign and blank key, roll null), DUPLICATE_ROW on both rows', async () => {
    const { svc } = setup();
    const res = await svc.validate(
      EXAM,
      Q,
      sheet([
        row(2, 'st1', { Written: { kind: 'invalid' } }),
        row(3, 'zzz', { Written: val('5') }),
        row(4, '', { Written: val('5') }),
        row(5, 'st2', { Written: val('5') }),
        row(6, 'st2', { Written: val('6') }, true),
      ]),
      T,
      'ADMIN',
      U,
    );
    const codes = res.errors.map((e) => [e.row, e.code, e.roll]);
    expect(codes).toEqual([
      [2, MarksSheetRowErrorCode.INVALID_VALUE, 1],
      [3, MarksSheetRowErrorCode.NOT_IN_SECTION, null],
      [4, MarksSheetRowErrorCode.NOT_IN_SECTION, null],
      [5, MarksSheetRowErrorCode.DUPLICATE_ROW, 2],
      [6, MarksSheetRowErrorCode.DUPLICATE_ROW, 2],
    ]);
    expect(res.changes).toHaveLength(0);
  });

  it('UNKNOWN_COMPONENT has component_name null; DERIVED_COMPONENT carries the DB name', async () => {
    const { svc } = setup();
    const res = await svc.validate(
      EXAM,
      Q,
      sheet([row(2, 'st2', { Written: val('5') })], {
        components: [
          { name: 'Written', fullMarksHeader: 'x' },
          { name: '=evil', fullMarksHeader: 'x' },
          { name: 'Att', fullMarksHeader: 'x' },
        ],
      }),
      T,
      'ADMIN',
      U,
    );
    expect(res.errors).toEqual([
      { row: 1, roll: null, component_name: null, code: MarksSheetRowErrorCode.UNKNOWN_COMPONENT },
      { row: 1, roll: null, component_name: 'Att', code: MarksSheetRowErrorCode.DERIVED_COMPONENT },
    ]);
    expect(JSON.stringify(res)).not.toContain('evil');
  });

  it('zero components, or a missing or different sheetId, is WRONG_SHEET', async () => {
    const { svc } = setup();
    const wrong = { code: MarksSheetFileErrorCode.WRONG_SHEET };
    await expect(
      svc.validate(EXAM, Q, sheet([], { components: [] }), T, 'ADMIN', U),
    ).rejects.toMatchObject(wrong);
    await expect(
      svc.validate(EXAM, Q, sheet([row(2, 'st1', {})], { sheetId: undefined }), T, 'ADMIN', U),
    ).rejects.toMatchObject(wrong);
    await expect(
      svc.validate(
        EXAM,
        Q,
        sheet([row(2, 'st1', {})], { sheetId: `${EXAM}:${SEC}:other` }),
        T,
        'ADMIN',
        U,
      ),
    ).rejects.toMatchObject(wrong);
  });

  it('never echoes the raw key or roll text', async () => {
    const { svc } = setup();
    const res = await svc.validate(
      EXAM,
      Q,
      sheet([row(2, '=evil', { Written: val('5') }), row(3, 'st1', { Written: val('99') })]),
      T,
      'ADMIN',
      U,
    );
    expect(JSON.stringify(res)).not.toMatch(/evil|RAW-ROLL/);
  });
});

describe('MarksImportService gates', () => {
  it('assertCanWrite rejects before getGrid and before parsing', async () => {
    const { svc, authz, gridService } = setup();
    authz.assertCanWrite.mockRejectedValueOnce(new NotFoundException('Section not found'));
    const spy = vi.spyOn(parser, 'parseMarksSheet');
    await expect(
      svc.validateFile(
        EXAM,
        Q,
        { size: 1, buffer: Buffer.from('x'), originalname: 'a.xlsx' } as never,
        T,
        'TEACHER',
        U,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(gridService.getGrid).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('PUBLISHED exam is a 409', async () => {
    const { svc } = setup(makeGrid(), ExamStatus.PUBLISHED);
    await expect(svc.validate(EXAM, Q, sheet([]), T, 'ADMIN', U)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('SUBMITTED grid is GRID_SUBMITTED', async () => {
    const { svc } = setup(makeGrid({ state: MarkGridState.SUBMITTED }));
    await expect(svc.validate(EXAM, Q, sheet([]), T, 'ADMIN', U)).rejects.toMatchObject({
      response: { details: { code: 'GRID_SUBMITTED' } },
    });
  });

  it('a file over 5 MB is TOO_LARGE before parsing', async () => {
    const { svc } = setup();
    const spy = vi.spyOn(parser, 'parseMarksSheet');
    spy.mockClear();
    await expect(
      svc.validateFile(
        EXAM,
        Q,
        { size: 6 * 1024 * 1024, buffer: Buffer.alloc(10), originalname: 'a.csv' } as never,
        T,
        'ADMIN',
        U,
      ),
    ).rejects.toMatchObject({ code: ImportFileErrorCode.TOO_LARGE });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('MarksImportService.commit', () => {
  const dto = { staging_id: 'stg', section_id: SEC, subject_id: SUB };
  const ctx = { ip: null, userAgent: null };
  const staged = {
    examId: EXAM,
    sectionId: SEC,
    subjectId: SUB,
    cells: [{ student_id: 'st1', component_id: 'c1', value: '50.00', status: MarkStatus.PRESENT }],
  };

  it('calls upsertBatch once with exactly the staged cells, staged ids and SHEET', async () => {
    const { svc, staging, marksService } = setup();
    staging.consume.mockResolvedValueOnce(staged);
    const res = await svc.commit(EXAM, dto, T, 'ADMIN', U, ctx);
    expect(res).toEqual({ saved: 1 });
    expect(marksService.upsertBatch).toHaveBeenCalledTimes(1);
    expect(marksService.upsertBatch).toHaveBeenCalledWith(
      EXAM,
      { section_id: SEC, subject_id: SUB, cells: staged.cells },
      T,
      'ADMIN',
      U,
      ctx,
      'SHEET',
    );
  });

  it('a consumed or expired stage is 410', async () => {
    const { svc, staging, marksService } = setup();
    staging.consume.mockResolvedValueOnce(null);
    await expect(svc.commit(EXAM, dto, T, 'ADMIN', U, ctx)).rejects.toMatchObject({ status: 410 });
    expect(marksService.upsertBatch).not.toHaveBeenCalled();
  });

  it('an exam or section mismatch with the stage is the same 410', async () => {
    const { svc, staging, marksService } = setup();
    staging.consume.mockResolvedValueOnce({ ...staged, examId: 'other' });
    await expect(svc.commit(EXAM, dto, T, 'ADMIN', U, ctx)).rejects.toMatchObject({ status: 410 });
    staging.consume.mockResolvedValueOnce({ ...staged, sectionId: 'other' });
    await expect(svc.commit(EXAM, dto, T, 'ADMIN', U, ctx)).rejects.toMatchObject({ status: 410 });
    expect(marksService.upsertBatch).not.toHaveBeenCalled();
  });
});
