import { describe, expect, it, vi } from 'vitest';
import { CommunicationMedium, EnrollmentStatus } from '@biddaloy/shared';
import { BLOOD_GROUPS } from '../../../students/dto/students.dto';
import { Student } from '../../../students/entities/student.entity';
import type { Guardian } from '../../../students/entities/guardian.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import { schoolTab } from '../school/school.tab';
import { usersTab } from './users.tab';
import { teachersTab } from './teachers.tab';
import { teacherAssignmentsTab } from './teacher-assignments.tab';
import { guardiansTab } from './guardians.tab';
import { academicYearsTab, classesTab, sectionsTab } from '../academics';
import { studentsTab, type StudentRow } from './students.tab';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLASS_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const YEAR_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GUARDIAN_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GUARDIAN_2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const usersByEmail: Record<string, string> = { 'student@dhaka-model.test': USER_ID };
const sectionsByKey: Record<string, string> = { 'Six|2026|A': SECTION_ID };
const classesByKey: Record<string, string> = { 'Six|2026': CLASS_ID };
const yearsByKey: Record<string, string> = { '2026': YEAR_ID };
const guardiansByKey: Record<string, string> = {
  '01711111111': GUARDIAN_1,
  '01722222222': GUARDIAN_2,
};

function keyOfId(tab: string, id: string): string {
  const maps: Record<string, Record<string, string>> = {
    users: { [USER_ID]: 'student@dhaka-model.test' },
    sections: { [SECTION_ID]: 'Six|2026|A' },
    classes: { [CLASS_ID]: 'Six|2026' },
    academic_years: { [YEAR_ID]: '2026' },
    guardians: { [GUARDIAN_1]: '01711111111', [GUARDIAN_2]: '01722222222' },
  };
  return maps[tab]?.[id] ?? '';
}

function exportCtx(): ExportContext {
  return { keyOf: (tab: string, id: string) => keyOfId(tab, id) };
}

function importCtx(): ImportContext & { warn: ReturnType<typeof vi.fn> } {
  const refs: Record<string, Record<string, string>> = {
    users: usersByEmail,
    sections: sectionsByKey,
    classes: classesByKey,
    academic_years: yearsByKey,
    guardians: guardiansByKey,
  };
  return {
    tenantId: TENANT_ID,
    ref: (tab: string, key: string) => refs[tab]?.[key],
    warn: vi.fn<(e: RowError) => void>(),
  };
}

function makeStudent(overrides: Partial<Student> = {}): Student {
  return Object.assign(new Student(), {
    id: STUDENT_ID,
    user_id: USER_ID,
    registration_number: 'STU-001',
    full_name: 'Karim Uddin Jr.',
    full_name_bn: 'করিম উদ্দিন',
    blood_group: 'O+',
    photo_key: `tenants/${TENANT_ID}/student-photo/karim.jpg`,
    roll_number: 1,
    class_section_id: SECTION_ID,
    class_section: {
      id: SECTION_ID,
      class_id: CLASS_ID,
      class: { id: CLASS_ID, academic_year_id: YEAR_ID },
    } as never,
    date_of_birth: null,
    gender: null,
    home_address: null,
    religion: null,
    birth_reg_no: null,
    card_no: 'C-9',
    health_notes: null,
    father_name: null,
    mother_name: null,
    preferred_communication: CommunicationMedium.SMS,
    enrollment_status: EnrollmentStatus.ACTIVE,
    tenant_id: TENANT_ID,
    guardians: [{ id: GUARDIAN_1 }, { id: GUARDIAN_2 }] as unknown as Guardian[],
    ...overrides,
  } satisfies Partial<Student>);
}

/** Real pipeline, both directions, mirroring `guardians.tab.spec.ts`. */
function toCells(student: Student): Record<string, string> {
  const row = studentsTab.toRow(student, exportCtx());
  const cells: Record<string, string> = {};
  for (const column of studentsTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function fromRowOrThrow(
  cells: Record<string, string>,
  ctx: ImportContext = importCtx(),
): StudentRow {
  const result = studentsTab.fromRow(cells, 2, ctx);
  if ('errors' in result) {
    throw new Error(`Unexpected errors: ${JSON.stringify(result.errors)}`);
  }
  return result.row;
}

describe('studentsTab shape', () => {
  it('is registered through the people barrel, after guardians', () => {
    expect(peopleTabs).toContain(studentsTab);
    expect(peopleTabs.indexOf(guardiansTab)).toBeLessThan(peopleTabs.indexOf(studentsTab));
    expect(peopleTabs.map((t) => t.name).slice(-9)).toEqual([
      'guardians',
      'students',
      'enrollments',
      // [27.6] admission tabs appended after enrollments.
      'admission_intakes',
      'admission_applicants',
      'admission_evaluations',
      // [39.1.3] student child tabs appended after the admission tabs.
      'student_lifecycle_events',
      'student_notes',
      'student_public_exams',
    ]);
  });

  it('satisfies the registry contract', () => {
    expect(() =>
      assertRegistryValid(
        [
          schoolTab,
          academicYearsTab,
          classesTab,
          sectionsTab,
          usersTab,
          teachersTab,
          teacherAssignmentsTab,
          guardiansTab,
          studentsTab,
        ],
        { partial: true },
      ),
    ).not.toThrow();
  });

  it('throws when dependsOn is missing classes (C3 regression guard)', () => {
    const broken = {
      ...studentsTab,
      dependsOn: ['sections', 'guardians', 'users', 'academic_years'],
    };
    expect(() =>
      assertRegistryValid(
        [
          schoolTab,
          academicYearsTab,
          classesTab,
          sectionsTab,
          usersTab,
          teachersTab,
          teacherAssignmentsTab,
          guardiansTab,
          broken,
        ],
        { partial: true },
      ),
    ).toThrow();
  });

  it('declares its dependency and identity shape', () => {
    expect(studentsTab.name).toBe('students');
    expect(studentsTab.dependsOn).toEqual([
      'sections',
      'guardians',
      'users',
      'classes',
      'academic_years',
    ]);
    expect(studentsTab.naturalKey).toEqual(['registration_number']);
    expect(studentsTab.deleteByAbsence).toBe(true);
  });

  it('excludes exactly user_id and class_section_id', () => {
    expect(studentsTab.excluded).toEqual(['user_id', 'class_section_id']);
    const exported = studentsTab.columns.map((c) => c.key);
    expect(exported).not.toContain('user_id');
    expect(exported).not.toContain('class_section_id');
  });
});

describe('keyOf', () => {
  it('returns registration_number for both a row and an entity, and they match', () => {
    const student = makeStudent();
    const cells = toCells(student);
    const row = fromRowOrThrow(cells);
    expect(studentsTab.keyOf(student)).toBe('STU-001');
    expect(studentsTab.keyOf(row)).toBe(studentsTab.keyOf(student));
  });
});

describe('photo_key across schools (Epic 32)', () => {
  it("rewrites another school's photo key to this school and warns", () => {
    const ctx = importCtx();
    const cells = toCells(makeStudent({ photo_key: 'tenants/other-school/student-photo/p.jpg' }));

    const row = fromRowOrThrow(cells, ctx);

    expect(row.photo_key).toBe(`tenants/${TENANT_ID}/student-photo/p.jpg`);
    expect(ctx.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: 'students',
        column: 'photo_key',
        severity: 'warning',
        message: 'This photo came from another school. Its file was not copied; upload it again.',
      }),
    );
  });

  it('does not warn about a foreign photo when the row is rejected for another reason', () => {
    const ctx = importCtx();
    const cells = {
      ...toCells(makeStudent({ photo_key: 'tenants/other-school/student-photo/p.jpg' })),
      guardian_phones: '01799999999', // no such guardian -> row error
    };

    expect('errors' in studentsTab.fromRow(cells, 2, ctx)).toBe(true);
    expect(ctx.warn).not.toHaveBeenCalled();
  });

  it("rejects this school's own key when it is outside the student-photo/ folder", () => {
    // e.g. the school's own workbook backup: the photo route must never stream it.
    const key = `tenants/${TENANT_ID}/workbook-backups/full.xlsx`;
    const result = studentsTab.fromRow(toCells(makeStudent({ photo_key: key })), 2, importCtx());

    expect('errors' in result).toBe(true);
    if ('errors' in result) expect(result.errors[0]).toMatchObject({ column: 'photo_key' });
  });

  it('rejects a photo key outside tenants/ (e.g. a platform backup)', () => {
    const result = studentsTab.fromRow(
      toCells(makeStudent({ photo_key: 'backups/db/20261009T020000Z.dump.age' })),
      2,
      importCtx(),
    );

    expect('errors' in result).toBe(true);
    if ('errors' in result) expect(result.errors[0]).toMatchObject({ column: 'photo_key' });
  });

  it('keeps a photo key that already belongs to this school, without a warning', () => {
    const ctx = importCtx();
    const key = `tenants/${TENANT_ID}/student-photo/p.jpg`;

    expect(fromRowOrThrow(toCells(makeStudent({ photo_key: key })), ctx).photo_key).toBe(key);
    expect(ctx.warn).not.toHaveBeenCalled();
  });
});

describe('round-trip', () => {
  it('fromRow(toRow(entity)) round-trips every field for a fully populated student', () => {
    const student = makeStudent();
    const cells = toCells(student);
    const row = fromRowOrThrow(cells);

    expect(row).toEqual({
      id: student.id,
      registration_number: 'STU-001',
      full_name: 'Karim Uddin Jr.',
      full_name_bn: 'করিম উদ্দিন',
      blood_group: 'O+',
      photo_key: `tenants/${TENANT_ID}/student-photo/karim.jpg`,
      roll_number: 1,
      class_section_id: SECTION_ID,
      date_of_birth: null,
      gender: null,
      home_address: null,
      religion: null,
      birth_reg_no: null,
      card_no: 'C-9',
      health_notes: null,
      father_name: null,
      mother_name: null,
      preferred_communication: CommunicationMedium.SMS,
      enrollment_status: EnrollmentStatus.ACTIVE,
      guardian_ids: expect.arrayContaining([GUARDIAN_1, GUARDIAN_2]),
      user_id: USER_ID,
      class_key: 'Six|2026',
      academic_year_key: '2026',
      section_key: 'Six|2026|A',
      guardian_keys: ['01711111111', '01722222222'],
      user_key: 'student@dhaka-model.test',
    } satisfies StudentRow);
    expect(row.guardian_ids).toHaveLength(2);
  });

  it('renders ref cells as natural keys, never uuids (except id)', () => {
    const student = makeStudent();
    const cells = toCells(student);
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(cells.section).toBe('Six|2026|A');
    expect(cells.class).toBe('Six|2026');
    expect(cells.academic_year).toBe('2026');
    expect(cells.user).toBe('student@dhaka-model.test');
    expect(cells.guardian_phones).toBe('01711111111;01722222222');

    for (const column of studentsTab.columns) {
      if (column.key === 'id') continue;
      expect(uuidLike.test(cells[column.key])).toBe(false);
    }
  });

  it('a null date_of_birth/gender/user round-trips as null', () => {
    const student = makeStudent({
      user_id: null,
      date_of_birth: null,
      gender: null,
      guardians: [],
    });
    const cells = toCells(student);
    const row = fromRowOrThrow(cells);
    expect(row.date_of_birth).toBeNull();
    expect(row.gender).toBeNull();
    expect(row.user_id).toBeNull();
    expect(row.guardian_ids).toEqual([]);
  });

  it('an empty guardian_phones cell round-trips to an empty array with no error', () => {
    const student = makeStudent({ guardians: [] });
    const cells = toCells(student);
    expect(cells.guardian_phones).toBe('');
    const row = fromRowOrThrow(cells);
    expect(row.guardian_ids).toEqual([]);
  });

  it('a guardian key with a full_name|relationship fallback round-trips intact through the `;` delimiter', () => {
    const FALLBACK_KEY = 'Rahima Begum|Mother';
    const guardiansByKeyWithFallback: Record<string, string> = {
      [FALLBACK_KEY]: GUARDIAN_2,
    };
    const student = makeStudent({ guardians: [{ id: GUARDIAN_2 }] as unknown as Guardian[] });
    const cells: Record<string, string> = {};
    const row = studentsTab.toRow(student, {
      keyOf: (tab: string, id: string) => {
        if (tab === 'guardians' && id === GUARDIAN_2) return FALLBACK_KEY;
        return keyOfId(tab, id);
      },
    });
    for (const column of studentsTab.columns) {
      const cell = toCell(column.type, row[column.key]);
      cells[column.key] = cellText(cell === null ? '' : String(cell));
    }
    expect(cells.guardian_phones).toBe(FALLBACK_KEY);

    const result = studentsTab.fromRow(cells, 2, {
      tenantId: TENANT_ID,
      ref: (tab: string, key: string) =>
        tab === 'sections'
          ? sectionsByKey[key]
          : tab === 'classes'
            ? classesByKey[key]
            : tab === 'academic_years'
              ? yearsByKey[key]
              : tab === 'guardians'
                ? guardiansByKeyWithFallback[key]
                : usersByEmail[key],
      warn: vi.fn<(e: RowError) => void>(),
    });
    if ('errors' in result) throw new Error(JSON.stringify(result.errors));
    expect(result.row.guardian_ids).toEqual([GUARDIAN_2]);
  });

  it('a guardian key listed twice in one cell resolves to a single id', () => {
    const student = makeStudent();
    const cells = toCells(student);
    cells.guardian_phones = '01711111111;01711111111';
    const row = fromRowOrThrow(cells);
    expect(row.guardian_ids).toEqual([GUARDIAN_1]);
  });
});

describe('fromRow validation', () => {
  it('an unresolvable guardian key yields one RowError per unresolved entry', () => {
    const student = makeStudent();
    const cells = toCells(student);
    cells.guardian_phones = '01711111111;01799999999';

    const result = studentsTab.fromRow(cells, 4, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('guardian_phones');
    expect(errors[0].value).toBe('01799999999');
  });

  it('a missing section yields a RowError on section', () => {
    const student = makeStudent();
    const cells = toCells(student);
    cells.section = 'Nowhere|2026|Z';

    const result = studentsTab.fromRow(cells, 5, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors.some((e) => e.column === 'section')).toBe(true);
  });

  it('a bad enrollment_status yields a RowError listing the allowed values', () => {
    const student = makeStudent();
    const cells = toCells(student);
    cells.enrollment_status = 'ON_VACATION';

    const result = studentsTab.fromRow(cells, 6, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    const err = errors.find((e) => e.column === 'enrollment_status');
    expect(err).toBeDefined();
    for (const value of Object.values(EnrollmentStatus)) {
      expect(err!.message).toContain(value);
    }
  });

  it('a blood_group outside the allowlist yields a RowError listing the allowed values', () => {
    const student = makeStudent();
    const cells = toCells(student);
    cells.blood_group = 'C+';

    const result = studentsTab.fromRow(cells, 7, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    const err = errors.find((e) => e.column === 'blood_group');
    expect(err).toBeDefined();
    for (const value of BLOOD_GROUPS) {
      expect(err!.message).toContain(value);
    }
  });

  it('a registration_number over 50 characters yields the max-length error', () => {
    const student = makeStudent();
    const cells = toCells(student);
    cells.registration_number = 'A'.repeat(51);

    const result = studentsTab.fromRow(cells, 7, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors.some((e) => e.column === 'registration_number' && e.message.includes('50'))).toBe(
      true,
    );
  });
});

describe('fromRow defaults', () => {
  it('empty preferred_communication/enrollment_status cells default to SMS/ACTIVE', () => {
    const student = makeStudent();
    const cells = toCells(student);
    cells.preferred_communication = '';
    cells.enrollment_status = '';

    const row = fromRowOrThrow(cells);
    expect(row.preferred_communication).toBe(CommunicationMedium.SMS);
    expect(row.enrollment_status).toBe(EnrollmentStatus.ACTIVE);
  });
});

describe('diffFields', () => {
  it('reports no changes when nothing differs', () => {
    const student = makeStudent();
    const row = fromRowOrThrow(toCells(student));
    expect(studentsTab.diffFields(row, student)).toEqual([]);
  });

  it('names the changed field', () => {
    const student = makeStudent();
    const row = fromRowOrThrow(toCells(student));
    expect(studentsTab.diffFields({ ...row, full_name: 'Someone Else' }, student)).toEqual([
      'full_name',
    ]);
  });

  // #2668: the export writes a blank login cell when the login's owner has left.
  it('a blank login cell on a departed login is not a change', () => {
    const e: any = makeStudent({ user_id: 'u-1' });
    e.user_key = '';
    const row = { ...fromRowOrThrow(toCells(e)), user_id: null };
    expect(studentsTab.diffFields(row, e)).toEqual([]);
  });

  it('a blank login cell on a current login is a change (blank means clear)', () => {
    const e: any = makeStudent({ user_id: 'u-1' });
    e.user_key = 'a@x';
    const row = { ...fromRowOrThrow(toCells(e)), user_id: null };
    expect(studentsTab.diffFields(row, e)).toEqual(['user_id']);
  });
});
