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
 * [8.15 follow-up #3523] Programs, one row per enrolment of a student in a program (a student in
 * two programs has two rows). The class and section are the student's current ones. Programs have
 * no soft delete, an archived one stays visible through `is_active`. Needs PROGRAM_READ.
 */
export const programsArea: SubjectAreaDef = {
  key: ReportSubjectArea.PROGRAMS,
  root: { alias: 'pe', table: 'program_enrollments', tenantColumn: 'tenant_id' },
  permission: Permission.PROGRAM_READ,
  scope: { sectionSql: 's.class_section_id', alias: 's' },
  joins: [
    { from: 'pe', to: students, on: 'pe.student_id = s.id', kind: 'inner' },
    {
      from: 'pe',
      to: { alias: 'pr', table: 'programs', tenantColumn: 'tenant_id' },
      on: 'pe.program_id = pr.id',
      kind: 'inner',
    },
    { from: 's', to: sections, on: 's.class_section_id = cs.id', kind: 'left' },
    { from: 'cs', to: classes, on: 'cs.class_id = c.id', kind: 'left' },
  ],
  fields: [
    field('program', T.TEXT, 'pr.name', 'pr', { en: 'Program', bn: 'প্রোগ্রাম' }),
    field('program_active', T.BOOLEAN, 'pr.is_active', 'pr', {
      en: 'Program is open',
      bn: 'প্রোগ্রাম চালু',
    }),
    field(
      'status',
      T.ENUM,
      'pe.status',
      'pe',
      { en: 'Status', bn: 'অবস্থা' },
      { enumValues: ['ACTIVE', 'COMPLETED', 'WITHDRAWN'] },
    ),
    field('started_on', T.DATE, 'pe.started_on', 'pe', { en: 'Started on', bn: 'শুরুর তারিখ' }),
    field('ended_on', T.DATE, 'pe.ended_on', 'pe', { en: 'Ended on', bn: 'শেষের তারিখ' }),
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
    field('class', T.TEXT, 'c.name', 'c', { en: 'Class', bn: 'শ্রেণি' }),
    field('section', T.TEXT, 'cs.section_name', 'cs', { en: 'Section', bn: 'শাখা' }),
  ],
  measures: [
    measure('students', AggregateFn.COUNT_DISTINCT, 'pe.student_id', 'pe', T.NUMBER, {
      en: 'Students',
      bn: 'শিক্ষার্থী',
    }),
    measure('enrolments', AggregateFn.COUNT, 'pe.id', 'pe', T.NUMBER, {
      en: 'Enrolments',
      bn: 'ভর্তি',
    }),
  ],
};
