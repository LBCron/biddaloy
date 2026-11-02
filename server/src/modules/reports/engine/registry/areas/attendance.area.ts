import {
  AggregateFn,
  FieldSensitivity as S,
  ReportFieldType as T,
  ReportSubjectArea,
} from '@biddaloy/shared';
import { classes, field, measure, sections, students } from '../define';
import type { SubjectAreaDef } from '../registry.types';

const PRESENT_SQL = "ar.status IN ('PRESENT', 'LATE')";

/**
 * [8.15.21] Daily attendance, one row per student per marked session. The section comes from the
 * session. "Present" counts a late student as present, as the attendance screens do.
 */
export const attendanceArea: SubjectAreaDef = {
  key: ReportSubjectArea.ATTENDANCE,
  root: { alias: 'ar', table: 'attendance_records', tenantColumn: 'tenant_id' },
  scope: { sectionSql: 'sess.section_id', alias: 'sess' },
  joins: [
    { from: 'ar', to: students, on: 'ar.student_id = s.id', kind: 'inner' },
    {
      from: 'ar',
      to: { alias: 'sess', table: 'attendance_sessions', tenantColumn: 'tenant_id' },
      on: 'ar.session_id = sess.id',
      kind: 'inner',
    },
    { from: 'sess', to: sections, on: 'sess.section_id = cs.id', kind: 'left' },
    { from: 'cs', to: classes, on: 'cs.class_id = c.id', kind: 'left' },
  ],
  fields: [
    field('date', T.DATE, 'ar.date', 'ar', { en: 'Date', bn: 'তারিখ' }),
    field(
      'status',
      T.ENUM,
      'ar.status',
      'ar',
      { en: 'Status', bn: 'অবস্থা' },
      {
        enumValues: ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'],
      },
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
      'registration_number',
      T.TEXT,
      's.registration_number',
      's',
      { en: 'Registration no.', bn: 'রেজিস্ট্রেশন নম্বর' },
      { sensitivity: S.PERSONAL, groupable: false },
    ),
    field('class', T.TEXT, 'c.name', 'c', { en: 'Class', bn: 'শ্রেণি' }),
    field('section', T.TEXT, 'cs.section_name', 'cs', { en: 'Section', bn: 'শাখা' }),
  ],
  measures: [
    measure('records', AggregateFn.COUNT, 'ar.id', 'ar', T.NUMBER, {
      en: 'Marks',
      bn: 'হাজিরার সংখ্যা',
    }),
    measure('present', AggregateFn.COUNT, `CASE WHEN ${PRESENT_SQL} THEN 1 END`, 'ar', T.NUMBER, {
      en: 'Present',
      bn: 'উপস্থিত',
    }),
    measure(
      'absent',
      AggregateFn.COUNT,
      "CASE WHEN ar.status = 'ABSENT' THEN 1 END",
      'ar',
      T.NUMBER,
      { en: 'Absent', bn: 'অনুপস্থিত' },
    ),
    measure(
      'present_percent',
      AggregateFn.AVG,
      `CASE WHEN ${PRESENT_SQL} THEN 100.0 ELSE 0 END`,
      'ar',
      T.PERCENT,
      { en: 'Present %', bn: 'উপস্থিতির হার' },
    ),
  ],
};
