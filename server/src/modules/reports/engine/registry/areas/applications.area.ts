import {
  AggregateFn,
  FieldSensitivity as S,
  Permission,
  ReportFieldType as T,
  ReportSubjectArea,
} from '@biddaloy/shared';
import { classes, field, measure, sections, students } from '../define';
import type { SubjectAreaDef } from '../registry.types';

const TYPES = [
  'STAFF_LEAVE',
  'STUDENT_LEAVE',
  'FEE_WAIVER',
  'TESTIMONIAL',
  'TRANSFER_CERTIFICATE',
  'READMISSION',
  'SECTION_CHANGE',
  'SCRIPT_RECHECK',
  'ID_CARD_REPRINT',
  'GENERAL',
];
const STATUSES = [
  'PENDING',
  'UNDER_CONSIDERATION',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED',
];

/**
 * [8.15 follow-up #3523] Applications, one row per application. The letter text and the form
 * payload are deliberately NOT here: a leave letter can carry a medical reason. What is here is
 * the kind, status, dates and who it is about. The class and section are the student subject's
 * current ones; an application about a staff member has none, so a TEACHER never sees one (their
 * section scope matches no row). The staff subject is not offered by name (no staff join): a staff
 * name would need the staff permission, not the student one. Needs APPLICATION_MANAGE.
 */
export const applicationsArea: SubjectAreaDef = {
  key: ReportSubjectArea.APPLICATIONS,
  root: { alias: 'ap', table: 'applications', tenantColumn: 'tenant_id' },
  permission: Permission.APPLICATION_MANAGE,
  scope: { sectionSql: 's.class_section_id', alias: 's' },
  joins: [
    { from: 'ap', to: students, on: 'ap.subject_student_id = s.id', kind: 'left' },
    { from: 's', to: sections, on: 's.class_section_id = cs.id', kind: 'left' },
    { from: 'cs', to: classes, on: 'cs.class_id = c.id', kind: 'left' },
  ],
  fields: [
    field('type', T.ENUM, 'ap.type', 'ap', { en: 'Type', bn: 'ধরন' }, { enumValues: TYPES }),
    field(
      'status',
      T.ENUM,
      'ap.status',
      'ap',
      { en: 'Status', bn: 'অবস্থা' },
      { enumValues: STATUSES },
    ),
    field(
      'source',
      T.ENUM,
      'ap.source',
      'ap',
      { en: 'Source', bn: 'উৎস' },
      { enumValues: ['APP', 'PAPER'] },
    ),
    field(
      'serial',
      T.TEXT,
      "ap.serial_year || '-' || ap.serial_no",
      'ap',
      { en: 'Serial', bn: 'ক্রমিক নম্বর' },
      { groupable: false },
    ),
    field('submitted_on', T.DATE, "(ap.created_at AT TIME ZONE 'Asia/Dhaka')::date", 'ap', {
      en: 'Submitted on',
      bn: 'জমার তারিখ',
    }),
    field('start_date', T.DATE, 'ap.start_date', 'ap', { en: 'From', bn: 'শুরু' }),
    field('end_date', T.DATE, 'ap.end_date', 'ap', { en: 'To', bn: 'শেষ' }),
    field('decided_on', T.DATE, "(ap.decided_at AT TIME ZONE 'Asia/Dhaka')::date", 'ap', {
      en: 'Decided on',
      bn: 'সিদ্ধান্তের তারিখ',
    }),
    field(
      'applicant_name',
      T.TEXT,
      'ap.applicant_name',
      'ap',
      { en: 'Applicant (paper)', bn: 'আবেদনকারী (কাগজে)' },
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
    measure('applications', AggregateFn.COUNT, 'ap.id', 'ap', T.NUMBER, {
      en: 'Applications',
      bn: 'আবেদন',
    }),
  ],
};
