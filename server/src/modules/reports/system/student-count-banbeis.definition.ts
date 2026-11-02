import {
  AggregateFn,
  FilterOp,
  ReportLayoutType,
  ReportParamType,
  ReportSubjectArea,
} from '@biddaloy/shared';
import { definitionFor, type SystemReportDef } from './definition-helpers';

/**
 * [8.15.32] G4: the BANBEIS head count, class by gender by religion, with totals. It replaces the early coded
 * count of [8.15.53] (D23). A COMMITTEE member opens it too: the engine hides any count under 5 for them.
 */
export const studentCountBanbeis: SystemReportDef = {
  key: 'student-count-banbeis',
  nameEn: 'Students by class and gender (BANBEIS)',
  nameBn: 'শ্রেণি ও লিঙ্গ অনুযায়ী ছাত্রসংখ্যা (BANBEIS)',
  descriptionEn: 'How many students there are in each class, boys and girls, by religion.',
  descriptionBn: 'প্রতিটি শ্রেণিতে কতজন ছাত্র ও ছাত্রী, ধর্ম অনুযায়ী।',
  folder: 'Students',
  visibleRoles: ['ADMIN', 'ACCOUNTANT', 'EXECUTIVE', 'COMMITTEE'],
  definition: definitionFor(
    ReportSubjectArea.STUDENTS,
    {
      parameters: [
        {
          key: 'academic_year',
          type: ReportParamType.ACADEMIC_YEAR,
          label_en: 'Year',
          label_bn: 'শিক্ষাবর্ষ',
          required: true,
        },
      ],
      dataset: {
        // `class_order` is split by only so the classes come out in school order (Six before Ten).
        dimensions: [
          { field: 'class_order' },
          { field: 'class' },
          { field: 'gender' },
          { field: 'religion' },
        ],
        measures: [{ field: 'students', fn: AggregateFn.COUNT_DISTINCT }],
        filters: [
          { field: 'status', op: FilterOp.EQ, value: 'ACTIVE' },
          { field: 'academic_year', op: FilterOp.EQ, value: { param: 'academic_year' } },
        ],
        sort: [{ field: 'class_order', dir: 'asc' }],
      },
      layout: {
        type: ReportLayoutType.CROSSTAB,
        rows: ['class'],
        columns: ['gender', 'religion'],
        cell_measure: 'students',
        totals: true,
      },
      page: {
        title_en: 'Students by class and gender (BANBEIS)',
        title_bn: 'শ্রেণি ও লিঙ্গ অনুযায়ী ছাত্রসংখ্যা (BANBEIS)',
        orientation: 'landscape',
      },
      drill: [
        {
          field: 'class',
          target: { report: 'student-list' },
          pass: { class: 'class', academic_year: 'academic_year' },
        },
      ],
    },
    {
      en: 'Students by class and gender (BANBEIS)',
      bn: 'শ্রেণি ও লিঙ্গ অনুযায়ী ছাত্রসংখ্যা (BANBEIS)',
    },
  ),
};
