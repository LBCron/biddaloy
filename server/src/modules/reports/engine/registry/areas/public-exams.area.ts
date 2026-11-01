import {
  AggregateFn,
  FieldSensitivity,
  ReportFieldType as T,
  ReportSubjectArea,
} from '@biddaloy/shared';
import { classes, field, measure, sections, students } from '../define';
import type { SubjectAreaDef } from '../registry.types';

const EXAMS = ['PSC', 'JSC', 'SSC', 'DAKHIL', 'HSC', 'ALIM'];

/**
 * [8.15.20] Public exam results, one row per student per exam. The class and section are the
 * student's current ones. A student counts as having passed with a GPA above 0.
 */
export const publicExamsArea: SubjectAreaDef = {
  key: ReportSubjectArea.PUBLIC_EXAMS,
  root: {
    alias: 'pe',
    table: 'student_public_exams',
    tenantColumn: 'tenant_id',
    softDeleteColumn: 'deleted_at',
  },
  scope: { sectionSql: 's.class_section_id', alias: 's' },
  joins: [
    { from: 'pe', to: students, on: 'pe.student_id = s.id', kind: 'inner' },
    { from: 's', to: sections, on: 's.class_section_id = cs.id', kind: 'left' },
    { from: 'cs', to: classes, on: 'cs.class_id = c.id', kind: 'left' },
  ],
  fields: [
    field(
      'exam',
      T.ENUM,
      'pe.exam_type',
      'pe',
      { en: 'Exam', bn: 'পরীক্ষা' },
      { enumValues: EXAMS },
    ),
    field('year', T.NUMBER, 'pe.passing_year', 'pe', { en: 'Year', bn: 'সাল' }),
    field('board', T.TEXT, 'pe.board', 'pe', { en: 'Board', bn: 'বোর্ড' }),
    field(
      'gpa',
      T.NUMBER,
      'pe.gpa',
      'pe',
      { en: 'GPA', bn: 'জিপিএ' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'roll_no',
      T.TEXT,
      'pe.roll_no',
      'pe',
      { en: 'Exam roll', bn: 'পরীক্ষার রোল' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'registration_no',
      T.TEXT,
      'pe.registration_no',
      'pe',
      { en: 'Exam registration', bn: 'পরীক্ষার রেজিস্ট্রেশন' },
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
      'gender',
      T.ENUM,
      's.gender',
      's',
      { en: 'Gender', bn: 'লিঙ্গ' },
      { enumValues: ['MALE', 'FEMALE', 'OTHER'] },
    ),
    field('class', T.TEXT, 'c.name', 'c', { en: 'Class', bn: 'শ্রেণি' }),
    field('section', T.TEXT, 'cs.section_name', 'cs', { en: 'Section', bn: 'শাখা' }),
  ],
  measures: [
    measure('exams', AggregateFn.COUNT, 'pe.id', 'pe', T.NUMBER, { en: 'Results', bn: 'ফলাফল' }),
    measure('passed', AggregateFn.COUNT, 'CASE WHEN pe.gpa > 0 THEN 1 END', 'pe', T.NUMBER, {
      en: 'Passed',
      bn: 'উত্তীর্ণ',
    }),
    measure('average_gpa', AggregateFn.AVG, 'pe.gpa', 'pe', T.NUMBER, {
      en: 'Average GPA',
      bn: 'গড় জিপিএ',
    }),
  ],
};
