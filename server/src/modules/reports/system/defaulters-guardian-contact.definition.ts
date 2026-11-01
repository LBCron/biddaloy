import {
  AggregateFn,
  FilterOp,
  ReportLayoutType,
  ReportParamType,
  ReportSubjectArea,
} from '@biddaloy/shared';
import { FINANCE_AND_LEADERS, definitionFor, type SystemReportDef } from './definition-helpers';

/** [8.15.32] Who still owes, with the guardian's phone, grouped by class. Replaces the "defaulters" ask of #384. */
export const defaultersGuardianContact: SystemReportDef = {
  key: 'defaulters-guardian-contact',
  nameEn: 'Still owed, with guardian phone',
  nameBn: 'বকেয়া — অভিভাবকের ফোনসহ',
  descriptionEn: 'Students with unpaid bills, how much is still owed, and who to call.',
  descriptionBn: 'যাদের বিল বাকি, কত বাকি এবং কাকে ফোন করবেন।',
  folder: 'Finance',
  visibleRoles: FINANCE_AND_LEADERS,
  definition: definitionFor(
    ReportSubjectArea.FEES,
    {
      parameters: [
        {
          key: 'class',
          type: ReportParamType.CLASS,
          label_en: 'Class',
          label_bn: 'শ্রেণি',
          required: false,
        },
        {
          key: 'section',
          type: ReportParamType.SECTION,
          label_en: 'Section',
          label_bn: 'শাখা',
          required: false,
          depends_on: 'class',
        },
      ],
      dataset: {
        dimensions: [
          { field: 'class' },
          { field: 'section' },
          { field: 'registration_number' },
          { field: 'name' },
          { field: 'guardian_name' },
          { field: 'guardian_phone' },
          { field: 'ageing' },
        ],
        measures: [{ field: 'outstanding', fn: AggregateFn.SUM }],
        filters: [
          // The same set the dues list calls "open": bills that still owe money.
          { field: 'status', op: FilterOp.IN, value: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
          { field: 'class', op: FilterOp.EQ, value: { param: 'class' } },
          { field: 'section', op: FilterOp.EQ, value: { param: 'section' } },
        ],
        sort: [
          { field: 'class', dir: 'asc' },
          { field: 'section', dir: 'asc' },
          { field: 'name', dir: 'asc' },
        ],
      },
      layout: {
        type: ReportLayoutType.GROUPED,
        group_by: ['class'],
        subtotals: true,
        totals: true,
      },
    },
    { en: 'Still owed, with guardian phone', bn: 'বকেয়া — অভিভাবকের ফোনসহ' },
  ),
};
