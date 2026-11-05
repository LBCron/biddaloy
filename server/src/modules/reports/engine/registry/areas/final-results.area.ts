import {
  AggregateFn,
  FieldSensitivity as S,
  Permission,
  ReportFieldType as T,
  ReportSubjectArea,
} from '@biddaloy/shared';
import { classes, field, measure, sections, students } from '../define';
import type { SubjectAreaDef } from '../registry.types';

/**
 * [8.15 follow-up #3523] Final results, one row per student per class per year. Only PUBLISHED
 * results are here (a row has `published_at` set while its result is published and cleared on
 * reopen), so a report never shows marks the school has not released. The class and year are the
 * result's own; the section is the one the student was in when it was computed.
 * Marks, GPA, grade and position say how one student did, so they are PERSONAL like the name. The
 * area needs RESULT_READ, the permission of the results screen.
 */
export const finalResultsArea: SubjectAreaDef = {
  key: ReportSubjectArea.FINAL_RESULTS,
  root: {
    alias: 'fr',
    table: 'final_result_rows',
    tenantColumn: 'tenant_id',
    softDeleteColumn: 'deleted_at',
  },
  permission: Permission.RESULT_READ,
  scope: { sectionSql: 'fr.section_id', alias: 'fr' },
  baseWhere: ['fr.published_at IS NOT NULL'],
  joins: [
    { from: 'fr', to: students, on: 'fr.student_id = s.id', kind: 'inner' },
    {
      from: 'fr',
      to: {
        alias: 'fin',
        table: 'final_results',
        tenantColumn: 'tenant_id',
        softDeleteColumn: 'deleted_at',
      },
      on: 'fr.final_result_id = fin.id',
      kind: 'inner',
    },
    { from: 'fr', to: sections, on: 'fr.section_id = cs.id', kind: 'left' },
    { from: 'fin', to: classes, on: 'fin.class_id = c.id', kind: 'left' },
    {
      from: 'fin',
      to: {
        alias: 'ay',
        table: 'academic_years',
        tenantColumn: 'tenant_id',
        softDeleteColumn: 'deleted_at',
      },
      on: 'fin.academic_year_id = ay.id',
      kind: 'left',
    },
  ],
  fields: [
    field(
      'registration_number',
      T.TEXT,
      's.registration_number',
      's',
      { en: 'Registration no.', bn: 'রেজিস্ট্রেশন নম্বর' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field(
      'name',
      T.TEXT,
      's.full_name',
      's',
      { en: 'Student name', bn: 'শিক্ষার্থীর নাম' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field(
      'roll',
      T.NUMBER,
      's.roll_number',
      's',
      { en: 'Roll', bn: 'রোল' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field(
      'total_marks',
      T.NUMBER,
      'fr.total_marks',
      'fr',
      { en: 'Total marks', bn: 'মোট নম্বর' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field(
      'gpa',
      T.NUMBER,
      'fr.gpa',
      'fr',
      { en: 'GPA', bn: 'জিপিএ' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field(
      'grade',
      T.TEXT,
      'fr.grade',
      'fr',
      { en: 'Grade', bn: 'গ্রেড' },
      { sensitivity: S.PERSONAL },
    ),
    field(
      'position',
      T.NUMBER,
      'fr.position',
      'fr',
      { en: 'Position in class', bn: 'শ্রেণিতে অবস্থান' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field(
      'section_position',
      T.NUMBER,
      'fr.section_position',
      'fr',
      { en: 'Position in section', bn: 'শাখায় অবস্থান' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field(
      'is_fail',
      T.BOOLEAN,
      'fr.is_fail',
      'fr',
      { en: 'Failed', bn: 'অকৃতকার্য' },
      { sensitivity: S.PERSONAL },
    ),
    field(
      'working_days',
      T.NUMBER,
      'fr.working_days',
      'fr',
      { en: 'Working days', bn: 'কার্যদিবস' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field(
      'present_days',
      T.NUMBER,
      'fr.present_days',
      'fr',
      { en: 'Days present', bn: 'উপস্থিত দিন' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field('class', T.TEXT, 'c.name', 'c', { en: 'Class', bn: 'শ্রেণি' }),
    field(
      'class_order',
      T.NUMBER,
      'c.numeric_grade',
      'c',
      { en: 'Class order', bn: 'শ্রেণির ক্রম' },
      { filterable: false },
    ),
    field('section', T.TEXT, 'cs.section_name', 'cs', { en: 'Section', bn: 'শাখা' }),
    field('academic_year', T.TEXT, 'ay.name', 'ay', { en: 'Academic year', bn: 'শিক্ষাবর্ষ' }),
  ],
  measures: [
    measure('students', AggregateFn.COUNT_DISTINCT, 'fr.student_id', 'fr', T.NUMBER, {
      en: 'Students',
      bn: 'শিক্ষার্থী',
    }),
    measure('failed', AggregateFn.COUNT, 'CASE WHEN fr.is_fail THEN 1 END', 'fr', T.NUMBER, {
      en: 'Failed',
      bn: 'অকৃতকার্য',
    }),
    measure(
      'average_gpa',
      AggregateFn.AVG,
      'fr.gpa',
      'fr',
      T.NUMBER,
      { en: 'Average GPA', bn: 'গড় জিপিএ' },
      S.PERSONAL,
    ),
    measure(
      'highest_gpa',
      AggregateFn.MAX,
      'fr.gpa',
      'fr',
      T.NUMBER,
      { en: 'Highest GPA', bn: 'সর্বোচ্চ জিপিএ' },
      S.PERSONAL,
    ),
  ],
};
