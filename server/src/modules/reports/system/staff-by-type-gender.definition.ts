import { AggregateFn, FilterOp, ReportLayoutType, ReportSubjectArea } from '@biddaloy/shared';
import { FINANCE_AND_LEADERS, definitionFor, type SystemReportDef } from './definition-helpers';

/**
 * [8.15.32] Staff by designation and by teaching or not. The ticket asked for gender too, but staff gender
 * is not recorded anywhere in the school data, so it is by type only.
 */
export const staffByTypeGender: SystemReportDef = {
  key: 'staff-by-type-gender',
  nameEn: 'Teachers and staff by type',
  nameBn: 'শিক্ষক ও কর্মচারী — ধরন অনুযায়ী',
  descriptionEn: 'How many teachers and other staff there are, by designation.',
  descriptionBn: 'পদবি অনুযায়ী কতজন শিক্ষক ও কর্মচারী আছেন।',
  folder: 'Staff',
  visibleRoles: FINANCE_AND_LEADERS,
  definition: definitionFor(
    ReportSubjectArea.STAFF,
    {
      parameters: [],
      dataset: {
        dimensions: [{ field: 'designation_bn' }, { field: 'staff_type' }],
        measures: [{ field: 'staff', fn: AggregateFn.COUNT_DISTINCT }],
        filters: [{ field: 'status', op: FilterOp.EQ, value: 'ACTIVE' }],
        sort: [{ field: 'designation_bn', dir: 'asc' }],
      },
      layout: {
        type: ReportLayoutType.CROSSTAB,
        rows: ['designation_bn'],
        columns: ['staff_type'],
        cell_measure: 'staff',
        totals: true,
      },
    },
    { en: 'Teachers and staff by type', bn: 'শিক্ষক ও কর্মচারী — ধরন অনুযায়ী' },
  ),
};
