import {
  AggregateFn,
  FieldSensitivity as S,
  ReportFieldType as T,
  ReportSubjectArea,
} from '@biddaloy/shared';
import {
  PRIMARY_GUARDIAN_ON,
  SCHOOL_TODAY_SQL,
  classes,
  field,
  guardians,
  measure,
  sections,
  students,
} from '../define';
import type { SubjectAreaDef } from '../registry.types';

/** The same set the dues screen and the checkout cart call "open": bills that still owe money. */
const OPEN = "sf.status IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')";
const OWED = '(sf.total_amount - sf.paid_amount - sf.discount_amount)';
const DAYS_LATE = `(${SCHOOL_TODAY_SQL} - COALESCE(sf.due_date, ${SCHOOL_TODAY_SQL}))`;

const AGEING_BUCKETS = ['CLOSED', 'NOT_DUE', 'D0_30', 'D31_60', 'D61_90', 'D90_PLUS'];
const AGEING_SQL = `CASE
  WHEN NOT (${OPEN}) THEN 'CLOSED'
  WHEN ${DAYS_LATE} <= 0 THEN 'NOT_DUE'
  WHEN ${DAYS_LATE} <= 30 THEN 'D0_30'
  WHEN ${DAYS_LATE} <= 60 THEN 'D31_60'
  WHEN ${DAYS_LATE} <= 90 THEN 'D61_90'
  ELSE 'D90_PLUS' END`;

/**
 * [8.15.21] Fees and dues, one row per student bill (`student_fees`). A bill has no school id of its
 * own, so it is scoped through its student. Class and section are the student's current ones, the
 * same as the dues screen. Every money measure is FINANCIAL and uses whole-bill amounts exactly as
 * the dues list does (billed minus paid minus discount), so the two reconcile.
 */
export const feesArea: SubjectAreaDef = {
  key: ReportSubjectArea.FEES,
  root: {
    alias: 'sf',
    table: 'student_fees',
    tenantColumn: null,
    tenantVia: 's',
    softDeleteColumn: 'deleted_at',
  },
  scope: { sectionSql: 's.class_section_id', alias: 's' },
  joins: [
    { from: 'sf', to: students, on: 'sf.student_id = s.id', kind: 'inner' },
    { from: 's', to: sections, on: 's.class_section_id = cs.id', kind: 'inner' },
    { from: 'cs', to: classes, on: 'cs.class_id = c.id', kind: 'inner' },
    {
      from: 'sf',
      to: {
        alias: 'fs',
        table: 'fee_structures',
        tenantColumn: 'tenant_id',
        softDeleteColumn: 'deleted_at',
      },
      on: 'sf.fee_structure_id = fs.id',
      kind: 'left',
    },
    { from: 's', to: guardians, on: PRIMARY_GUARDIAN_ON, kind: 'left' },
  ],
  fields: [
    field(
      'fee_type',
      T.ENUM,
      'fs.fee_type',
      'fs',
      { en: 'Fee type', bn: 'ফির ধরন' },
      {
        enumValues: [
          'MONTHLY_TUITION',
          'EXAM_FEE',
          'LIBRARY_FEE',
          'LAB_FEE',
          'SPORTS_FEE',
          'COMPUTER_FEE',
          'TRANSPORT_FEE',
          'ANNUAL_FEE',
          'ADMISSION_FEE',
          'OTHER',
          'LATE_FEE',
          'FINE',
        ],
      },
    ),
    field('fee_name', T.TEXT, 'fs.name', 'fs', { en: 'Fee name', bn: 'ফির নাম' }),
    field('due_date', T.DATE, 'sf.due_date', 'sf', { en: 'Due date', bn: 'শেষ তারিখ' }),
    field(
      'status',
      T.ENUM,
      'sf.status',
      'sf',
      { en: 'Status', bn: 'অবস্থা' },
      {
        enumValues: ['PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'ADVANCE'],
      },
    ),
    field(
      'ageing',
      T.ENUM,
      AGEING_SQL,
      'sf',
      { en: 'Days late', bn: 'কত দিন বাকি' },
      { enumValues: AGEING_BUCKETS, sortable: false },
    ),
    field(
      'name',
      T.TEXT,
      's.full_name',
      's',
      { en: 'Student name', bn: 'শিক্ষার্থীর নাম' },
      { sensitivity: S.PERSONAL, groupable: true },
    ),
    field(
      'registration_number',
      T.TEXT,
      's.registration_number',
      's',
      { en: 'Registration no.', bn: 'রেজিস্ট্রেশন নম্বর' },
      { sensitivity: S.PERSONAL, groupable: true },
    ),
    field('class', T.TEXT, 'c.name', 'c', { en: 'Class', bn: 'শ্রেণি' }),
    field('section', T.TEXT, 'cs.section_name', 'cs', { en: 'Section', bn: 'শাখা' }),
    field(
      'guardian_name',
      T.TEXT,
      'g.full_name',
      'g',
      { en: 'Guardian name', bn: 'অভিভাবকের নাম' },
      { sensitivity: S.CONTACT, groupable: true },
    ),
    field(
      'guardian_phone',
      T.TEXT,
      'g.phone',
      'g',
      { en: 'Guardian phone', bn: 'অভিভাবকের ফোন' },
      { sensitivity: S.CONTACT, groupable: true, sortable: false },
    ),
  ],
  measures: [
    measure(
      'billed',
      AggregateFn.SUM,
      'sf.total_amount',
      'sf',
      T.MONEY,
      { en: 'Charged', bn: 'বিল' },
      S.FINANCIAL,
    ),
    measure(
      'paid',
      AggregateFn.SUM,
      'sf.paid_amount',
      'sf',
      T.MONEY,
      { en: 'Paid', bn: 'জমা' },
      S.FINANCIAL,
    ),
    measure(
      'outstanding',
      AggregateFn.SUM,
      `CASE WHEN ${OPEN} THEN ${OWED} ELSE 0 END`,
      'sf',
      T.MONEY,
      { en: 'Still owed', bn: 'বাকি' },
      S.FINANCIAL,
    ),
    measure('bills', AggregateFn.COUNT, 'sf.id', 'sf', T.NUMBER, {
      en: 'Bills',
      bn: 'বিলের সংখ্যা',
    }),
    measure(
      'overdue_bills',
      AggregateFn.COUNT,
      `CASE WHEN ${OPEN} AND ${DAYS_LATE} > 0 THEN 1 END`,
      'sf',
      T.NUMBER,
      { en: 'Late bills', bn: 'দেরি হওয়া বিল' },
    ),
  ],
};
