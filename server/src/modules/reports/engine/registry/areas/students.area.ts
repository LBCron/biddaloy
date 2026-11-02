import {
  AggregateFn,
  FieldSensitivity,
  ReportFieldType as T,
  ReportSubjectArea,
} from '@biddaloy/shared';
import {
  PRIMARY_GUARDIAN_ON,
  classes,
  field,
  guardians,
  measure,
  sections,
  students,
} from '../define';
import type { SubjectAreaDef } from '../registry.types';

const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'GRADUATED'];

/**
 * [8.15.20] Students, one row per enrolment (so a student has one row per academic year). The
 * school's own screens read the same tables: the class and section are the enrolment's, the
 * guardian is the student's main one (primary contact, else the first added).
 * Religion and photo are SENSITIVE / PERSONAL; the guardian's phone is CONTACT.
 */
export const studentsArea: SubjectAreaDef = {
  key: ReportSubjectArea.STUDENTS,
  root: { alias: 'e', table: 'enrollments', tenantColumn: 'tenant_id' },
  scope: { sectionSql: 'e.section_id', alias: 'e' },
  joins: [
    { from: 'e', to: students, on: 'e.student_id = s.id', kind: 'inner' },
    { from: 'e', to: sections, on: 'e.section_id = cs.id', kind: 'left' },
    { from: 'e', to: classes, on: 'e.class_id = c.id', kind: 'left' },
    {
      from: 'e',
      to: {
        alias: 'ay',
        table: 'academic_years',
        tenantColumn: 'tenant_id',
        softDeleteColumn: 'deleted_at',
      },
      on: 'e.academic_year_id = ay.id',
      kind: 'left',
    },
    { from: 's', to: guardians, on: PRIMARY_GUARDIAN_ON, kind: 'left' },
  ],
  fields: [
    field(
      'registration_number',
      T.TEXT,
      's.registration_number',
      's',
      { en: 'Registration no.', bn: 'রেজিস্ট্রেশন নম্বর' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'name',
      T.TEXT,
      's.full_name',
      's',
      { en: 'Student name', bn: 'শিক্ষার্থীর নাম' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'name_bn',
      T.TEXT,
      's.full_name_bn',
      's',
      { en: 'Student name (Bangla)', bn: 'শিক্ষার্থীর নাম (বাংলা)' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'roll',
      T.NUMBER,
      's.roll_number',
      's',
      { en: 'Roll', bn: 'রোল' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'gender',
      T.ENUM,
      's.gender',
      's',
      { en: 'Gender', bn: 'লিঙ্গ' },
      { enumValues: GENDERS },
    ),
    field(
      'religion',
      T.TEXT,
      's.religion',
      's',
      { en: 'Religion', bn: 'ধর্ম' },
      { sensitivity: FieldSensitivity.SENSITIVE },
    ),
    field(
      'birth_date',
      T.DATE,
      's.date_of_birth',
      's',
      { en: 'Date of birth', bn: 'জন্ম তারিখ' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'photo',
      T.TEXT,
      's.photo_key',
      's',
      { en: 'Photo', bn: 'ছবি' },
      {
        sensitivity: FieldSensitivity.PERSONAL,
        filterable: false,
        groupable: false,
        sortable: false,
      },
    ),
    field(
      'status',
      T.ENUM,
      'e.enrollment_status',
      'e',
      { en: 'Status', bn: 'অবস্থা' },
      { enumValues: STATUSES },
    ),
    field('class', T.TEXT, 'c.name', 'c', { en: 'Class', bn: 'শ্রেণি' }),
    // Sorting by class number keeps Class Six before Class Ten. A grouped report that wants that order splits by it too.
    field(
      'class_order',
      T.NUMBER,
      'c.numeric_grade',
      'c',
      { en: 'Class order', bn: 'শ্রেণির ক্রম' },
      { filterable: false },
    ),
    field('section', T.TEXT, 'cs.section_name', 'cs', { en: 'Section', bn: 'শাখা' }),
    field('shift', T.TEXT, 'c.shift', 'c', { en: 'Shift', bn: 'শিফট' }),
    field('version', T.TEXT, 'c.version', 'c', { en: 'Version', bn: 'ভার্সন' }),
    field('academic_year', T.TEXT, 'ay.name', 'ay', { en: 'Academic year', bn: 'শিক্ষাবর্ষ' }),
    field(
      'guardian_name',
      T.TEXT,
      'g.full_name',
      'g',
      { en: 'Guardian name', bn: 'অভিভাবকের নাম' },
      { sensitivity: FieldSensitivity.CONTACT, groupable: false },
    ),
    field(
      'guardian_phone',
      T.TEXT,
      'g.phone',
      'g',
      { en: 'Guardian phone', bn: 'অভিভাবকের ফোন' },
      { sensitivity: FieldSensitivity.CONTACT, groupable: false, sortable: false },
    ),
  ],
  measures: [
    measure('students', AggregateFn.COUNT_DISTINCT, 's.id', 's', T.NUMBER, {
      en: 'Students',
      bn: 'শিক্ষার্থী',
    }),
  ],
};
