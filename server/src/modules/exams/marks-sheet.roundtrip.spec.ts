import type { GridResponse } from './mark-grid.service';
import { parseMarksSheet } from './marks-sheet.parser';
import { makeFilledSheet } from './marks-sheet.test-helper';

// The contract later waves rely on: what the real builder writes, the real parser reads back.

const NAMES = ['Written', 'Practical', '=Written'];

function makeGrid(): GridResponse {
  const students = [1, 2, 3, 4].map((n) => ({
    id: `st${n}`,
    roll_number: n,
    full_name: `Student ${n}`,
    joined_after_exam: false,
    not_taking: false,
  }));
  const components = NAMES.map((name, i) => ({
    id: `c${i + 1}`,
    name,
    kind: 'WRITTEN',
    source: 'MANUAL',
    full_marks: '50',
    pass_marks: null,
    sequence: i + 1,
  }));
  return {
    exam_id: 'e',
    section_id: 's',
    subject_id: 'sub',
    state: 'DRAFT',
    submitted_by: null,
    submitted_at: null,
    students,
    components,
    cells: [],
    derived: {},
  } as unknown as GridResponse;
}

// A formula-like component name is written with a leading quote (neutralise); the helper matches
// the header text, so edit it by the quoted name.
const HEADER_NAME: Record<string, string> = { '=Written': "'=Written" };
const edit = (roll: number, component: string, cell: string | number | null) => ({
  roll,
  component: HEADER_NAME[component] ?? component,
  cell,
});

describe.each(['en', 'bn'] as const)('marks sheet round trip (%s)', (lang) => {
  const meta = { examName: 'Mid', sectionName: 'A', subjectName: 'Math', lang };

  it('reads back value / absent / exempt / blank for every entry, with key and roll', async () => {
    const buf = await makeFilledSheet(makeGrid(), meta, [
      edit(1, 'Written', 45),
      edit(1, 'Practical', 7.5),
      edit(1, '=Written', 'A'),
      edit(2, 'Written', 'অ'),
      edit(2, 'Practical', 'E'),
      edit(3, 'Written', 'ছাড়'),
      edit(3, '=Written', 30),
      // roll 4 untouched: all blank
    ]);
    const parsed = await parseMarksSheet(buf, 'm.xlsx');

    expect(parsed.components.map((c) => c.name)).toEqual(NAMES);
    expect(parsed.rows.map((r) => [r.studentKey, r.roll])).toEqual([
      ['st1', '1'],
      ['st2', '2'],
      ['st3', '3'],
      ['st4', '4'],
    ]);
    expect(parsed.rows.map((r) => r.entries)).toEqual([
      {
        Written: { kind: 'value', value: '45' },
        Practical: { kind: 'value', value: '7.5' },
        '=Written': { kind: 'absent' },
      },
      {
        Written: { kind: 'absent' },
        Practical: { kind: 'exempt' },
        '=Written': { kind: 'blank' },
      },
      {
        Written: { kind: 'exempt' },
        Practical: { kind: 'blank' },
        '=Written': { kind: 'value', value: '30' },
      },
      {
        Written: { kind: 'blank' },
        Practical: { kind: 'blank' },
        '=Written': { kind: 'blank' },
      },
    ]);
  });

  it('reads a Bangla digit string with the U+066B decimal separator', async () => {
    const buf = await makeFilledSheet(makeGrid(), meta, [edit(1, 'Written', '৭٫৫')]);
    const parsed = await parseMarksSheet(buf, 'm.xlsx');
    expect(parsed.rows[0].entries['Written']).toEqual({ kind: 'value', value: '7.5' });
  });

  it('ignores the Total column', async () => {
    const buf = await makeFilledSheet(makeGrid(), meta, [edit(1, 'Written', 10)]);
    const parsed = await parseMarksSheet(buf, 'm.xlsx');
    for (const row of parsed.rows) expect(Object.keys(row.entries)).toEqual(NAMES);
    expect(parsed.components.map((c) => c.name)).not.toContain('Total');
  });
});
