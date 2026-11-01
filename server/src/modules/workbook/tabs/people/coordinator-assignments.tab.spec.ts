import { describe, expect, it } from 'vitest';
import { CoordinatorAssignment } from '../../../academics/entities/coordinator-assignment.entity';
import { Teacher } from '../../../academics/entities/teacher.entity';
import { Class } from '../../../academics/entities/class.entity';
import { AcademicYear } from '../../../academics/entities/academic-year.entity';
import { Subject } from '../../../academics/entities/subject.entity';
import type { ImportContext, RowError } from '../../codec/tab-spec';
import {
  coordinatorAssignmentsTab,
  type CoordinatorAssignmentRow,
} from './coordinator-assignments.tab';

/** [83.2.3] Unit tests for the `coordinator_assignments` tab's cell mapping and keys. */
const ROW_ID = '55555555-5555-4555-8555-555555555555';
const TEACHER_ID = '66666666-6666-4666-8666-666666666666';
const CLASS_ID = '99999999-9999-4999-8999-999999999999';
const SUBJECT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '77777777-7777-4777-8777-777777777777';

// Natural keys the referenced tabs use: teacher = employee_id, class = name|year|shift|version,
// subject = code.
const KEYS: Record<string, Record<string, string>> = {
  teachers: { 'EMP-1': TEACHER_ID },
  classes: { 'Six|2026||': CLASS_ID },
  subjects: { MATH: SUBJECT_ID },
  users: { 'admin@school.test': USER_ID },
};
const ctx: ImportContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  ref: (tab, key) => KEYS[tab]?.[key],
  warn: () => undefined,
};
const cells = (over: Record<string, string> = {}) => ({
  id: ROW_ID,
  teacher: 'EMP-1',
  class: 'Six|2026||',
  subject: '',
  assigned_by: '',
  ...over,
});

describe('coordinatorAssignmentsTab', () => {
  it('depends on every tab it references', () => {
    expect([...coordinatorAssignmentsTab.dependsOn].sort()).toEqual(
      ['classes', 'subjects', 'teachers', 'users'].sort(),
    );
  });

  it('a blank subject is a class coordinator: subject_id NULL', () => {
    const out = coordinatorAssignmentsTab.fromRow(cells(), 2, ctx);
    expect('row' in out && out.row).toMatchObject({
      teacher_id: TEACHER_ID,
      class_id: CLASS_ID,
      subject_id: null,
      assigned_by_user_id: null,
    });
  });

  it('a subject cell resolves to the subject; assigned_by resolves to the user', () => {
    const out = coordinatorAssignmentsTab.fromRow(
      cells({ subject: 'MATH', assigned_by: 'admin@school.test' }),
      2,
      ctx,
    );
    expect('row' in out && out.row).toMatchObject({
      subject_id: SUBJECT_ID,
      assigned_by_user_id: USER_ID,
    });
  });

  it('an unknown class key is a row error with a fixed sentence', () => {
    const out = coordinatorAssignmentsTab.fromRow(cells({ class: 'Nine|2026||' }), 3, ctx);
    expect('errors' in out).toBe(true);
    const [err] = (out as { errors: RowError[] }).errors;
    expect(err).toMatchObject({ column: 'class', row: 3, value: 'Nine|2026||' });
    // Rule 23: the message names the column, never the typed value.
    expect(err.message).toBe('Column "class": no such class was found.');
  });

  it('builds the same key from a parsed row and from a loaded entity', () => {
    const parsed = coordinatorAssignmentsTab.fromRow(cells({ subject: 'MATH' }), 2, ctx) as {
      row: CoordinatorAssignmentRow;
    };
    const year = Object.assign(new AcademicYear(), { id: 'y', name: '2026' });
    const entity = Object.assign(new CoordinatorAssignment(), {
      id: ROW_ID,
      teacher_id: TEACHER_ID,
      class_id: CLASS_ID,
      subject_id: SUBJECT_ID,
      teacher: Object.assign(new Teacher(), { id: TEACHER_ID, employee_id: 'EMP-1' }),
      class: Object.assign(new Class(), {
        id: CLASS_ID,
        name: 'Six',
        academic_year_id: 'y',
        academic_year: year,
        shift: null,
        version: null,
      }),
      subject: Object.assign(new Subject(), { id: SUBJECT_ID, code: 'MATH' }),
    });
    expect(coordinatorAssignmentsTab.keyOf(entity)).toBe(
      coordinatorAssignmentsTab.keyOf(parsed.row),
    );
  });
});
