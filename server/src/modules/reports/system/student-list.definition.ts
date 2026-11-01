import { FilterOp, ReportLayoutType, ReportParamType, ReportSubjectArea } from '@biddaloy/shared';
import { FINANCE_AND_LEADERS, definitionFor, type SystemReportDef } from './definition-helpers';

const ask = (key: string) => ({ param: key });

/** [8.15.32] G1/G2: the school's students, by class, section, gender and religion. Every question is optional. */
export const studentList: SystemReportDef = {
  key: 'student-list',
  nameEn: 'Student list',
  nameBn: 'ছাত্রছাত্রীর তালিকা',
  descriptionEn: 'Every current student with class, section and guardian phone.',
  descriptionBn: 'প্রতিটি বর্তমান ছাত্রছাত্রী: শ্রেণি, শাখা ও অভিভাবকের ফোনসহ।',
  folder: 'Students',
  visibleRoles: FINANCE_AND_LEADERS,
  definition: definitionFor(
    ReportSubjectArea.STUDENTS,
    {
      parameters: [
        {
          key: 'academic_year',
          type: ReportParamType.ACADEMIC_YEAR,
          label_en: 'Year',
          label_bn: 'শিক্ষাবর্ষ',
          required: false,
        },
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
        {
          key: 'gender',
          type: ReportParamType.ENUM,
          label_en: 'Gender',
          label_bn: 'লিঙ্গ',
          required: false,
          options: [
            { value: 'MALE', label_en: 'Boys', label_bn: 'ছাত্র' },
            { value: 'FEMALE', label_en: 'Girls', label_bn: 'ছাত্রী' },
          ],
        },
        {
          key: 'religion',
          type: ReportParamType.TEXT,
          label_en: 'Religion',
          label_bn: 'ধর্ম',
          required: false,
        },
      ],
      dataset: {
        dimensions: [
          { field: 'roll' },
          { field: 'name' },
          { field: 'class' },
          { field: 'section' },
          { field: 'gender' },
          { field: 'guardian_name' },
          { field: 'guardian_phone' },
        ],
        measures: [],
        filters: [
          { field: 'status', op: FilterOp.EQ, value: 'ACTIVE' },
          { field: 'academic_year', op: FilterOp.EQ, value: ask('academic_year') },
          { field: 'class', op: FilterOp.EQ, value: ask('class') },
          { field: 'section', op: FilterOp.EQ, value: ask('section') },
          { field: 'gender', op: FilterOp.EQ, value: ask('gender') },
          { field: 'religion', op: FilterOp.EQ, value: ask('religion') },
        ],
        sort: [
          { field: 'class_order', dir: 'asc' },
          { field: 'section', dir: 'asc' },
          { field: 'roll', dir: 'asc' },
        ],
      },
      layout: { type: ReportLayoutType.TABLE },
    },
    { en: 'Student list', bn: 'ছাত্রছাত্রীর তালিকা' },
  ),
};
