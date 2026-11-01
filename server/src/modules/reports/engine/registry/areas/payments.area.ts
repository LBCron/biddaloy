import {
  AggregateFn,
  FieldSensitivity as S,
  ReportFieldType as T,
  ReportSubjectArea,
} from '@biddaloy/shared';
import { classes, field, measure, sections } from '../define';
import type { SubjectAreaDef } from '../registry.types';

const NOT_REVERSAL = 'p.reversal_of_payment_id IS NULL';

/**
 * [8.15.21] Payments, one row per payment row (a reversal is its own positive row that subtracts,
 * the convention of the payments list and the collections report). `baseWhere` is the collections
 * report's own rule for what counts: a payment that succeeded, or is one side of a reversal.
 * A student who was later deleted still shows: money is never hidden. The report author can filter
 * out reversals with `is_reversal`; it is never decided here.
 */
export const paymentsArea: SubjectAreaDef = {
  key: ReportSubjectArea.PAYMENTS,
  root: {
    alias: 'p',
    table: 'payments',
    tenantColumn: 'tenant_id',
    softDeleteColumn: 'deleted_at',
  },
  scope: { sectionSql: 's.class_section_id', alias: 's' },
  baseWhere: [
    "(p.payment_status = 'SUCCESS' OR p.reversal_of_payment_id IS NOT NULL OR p.reversed_by_payment_id IS NOT NULL)",
  ],
  joins: [
    // No soft-delete rule on the student: a payment of a removed student is still a payment.
    {
      from: 'p',
      to: { alias: 's', table: 'students', tenantColumn: 'tenant_id' },
      on: 'p.student_id = s.id',
      kind: 'left',
    },
    { from: 's', to: sections, on: 's.class_section_id = cs.id', kind: 'left' },
    { from: 'cs', to: classes, on: 'cs.class_id = c.id', kind: 'left' },
    {
      from: 'p',
      to: { alias: 'u', table: 'users', tenantColumn: null, tenantVia: 'p' },
      on: 'u.id = p.received_by_user_id',
      kind: 'left',
    },
  ],
  fields: [
    field('payment_date', T.DATE, "(p.payment_date AT TIME ZONE 'Asia/Dhaka')::date", 'p', {
      en: 'Date',
      bn: 'তারিখ',
    }),
    field(
      'method',
      T.ENUM,
      'p.payment_method',
      'p',
      { en: 'Method', bn: 'পদ্ধতি' },
      {
        enumValues: ['CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'BKASH', 'NAGAD', 'ROCKET'],
      },
    ),
    field(
      'status',
      T.ENUM,
      'p.payment_status',
      'p',
      { en: 'Status', bn: 'অবস্থা' },
      {
        enumValues: ['SUCCESS', 'PENDING', 'FAILED', 'REFUNDED'],
      },
    ),
    field(
      'collector',
      T.TEXT,
      'u.full_name',
      'u',
      { en: 'Collected by', bn: 'যিনি নিয়েছেন' },
      { sensitivity: S.FINANCIAL },
    ),
    field(
      'reference',
      T.TEXT,
      'p.transaction_reference',
      'p',
      { en: 'Reference', bn: 'রেফারেন্স' },
      { sensitivity: S.FINANCIAL, groupable: false },
    ),
    field('is_reversal', T.BOOLEAN, 'p.reversal_of_payment_id IS NOT NULL', 'p', {
      en: 'Is a reversal',
      bn: 'ফেরত কি না',
    }),
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
    measure(
      'collected',
      AggregateFn.SUM,
      `CASE WHEN ${NOT_REVERSAL} THEN p.total_amount ELSE 0 END`,
      'p',
      T.MONEY,
      { en: 'Paid', bn: 'জমা' },
      S.FINANCIAL,
    ),
    measure(
      'reversed',
      AggregateFn.SUM,
      `CASE WHEN ${NOT_REVERSAL} THEN 0 ELSE p.total_amount END`,
      'p',
      T.MONEY,
      { en: 'Taken back', bn: 'ফেরত' },
      S.FINANCIAL,
    ),
    measure(
      'net',
      AggregateFn.SUM,
      `CASE WHEN ${NOT_REVERSAL} THEN p.total_amount ELSE -p.total_amount END`,
      'p',
      T.MONEY,
      { en: 'Net paid', bn: 'নিট জমা' },
      S.FINANCIAL,
    ),
    measure('payments', AggregateFn.COUNT, `CASE WHEN ${NOT_REVERSAL} THEN 1 END`, 'p', T.NUMBER, {
      en: 'Payments',
      bn: 'জমার সংখ্যা',
    }),
  ],
};
