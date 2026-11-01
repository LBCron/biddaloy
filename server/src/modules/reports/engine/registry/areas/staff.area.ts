import {
  AggregateFn,
  FieldSensitivity,
  ReportFieldType as T,
  ReportSubjectArea,
} from '@biddaloy/shared';
import { field, measure } from '../define';
import type { SubjectAreaDef } from '../registry.types';

/**
 * [8.15.20] Staff, one row per staff profile. A person's current designation is the open one
 * (no end date; the latest if there are several). Staff gender is not stored anywhere, so there is
 * no gender field. A staff row has no section, so a TEACHER cannot run reports on this area.
 */
export const staffArea: SubjectAreaDef = {
  key: ReportSubjectArea.STAFF,
  root: { alias: 'sp', table: 'staff_profiles', tenantColumn: 'tenant_id' },
  joins: [
    {
      from: 'sp',
      to: {
        alias: 'u',
        table: 'users',
        tenantColumn: null,
        tenantVia: 'sp',
        softDeleteColumn: 'deleted_at',
      },
      on: 'u.id = sp.user_id',
      kind: 'inner',
    },
    {
      from: 'sp',
      to: { alias: 'hr', table: 'staff_hr_records', tenantColumn: 'tenant_id' },
      on: 'hr.user_id = sp.user_id',
      kind: 'left',
    },
    {
      from: 'sp',
      to: {
        alias: 'd',
        table: 'designations',
        tenantColumn: 'tenant_id',
        softDeleteColumn: 'deleted_at',
      },
      on: `d.id = (
        SELECT h.designation_id FROM staff_designation_history h
        WHERE h.tenant_id = sp.tenant_id AND h.user_id = sp.user_id AND h.end_date IS NULL
        ORDER BY h.effective_date DESC, h.id
        LIMIT 1)`,
      kind: 'left',
    },
  ],
  fields: [
    field(
      'name',
      T.TEXT,
      'u.full_name',
      'u',
      { en: 'Name', bn: 'নাম' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'name_bn',
      T.TEXT,
      'hr.name_bn',
      'hr',
      { en: 'Name (Bangla)', bn: 'নাম (বাংলা)' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field(
      'employee_id',
      T.TEXT,
      'sp.employee_id',
      'sp',
      { en: 'Employee ID', bn: 'কর্মচারী আইডি' },
      { sensitivity: FieldSensitivity.PERSONAL, groupable: false },
    ),
    field('designation', T.TEXT, 'd.title_en', 'd', { en: 'Designation', bn: 'পদবি' }),
    field('designation_bn', T.TEXT, 'd.title_bn', 'd', {
      en: 'Designation (Bangla)',
      bn: 'পদবি (বাংলা)',
    }),
    field(
      'staff_type',
      T.ENUM,
      "CASE d.is_teaching WHEN TRUE THEN 'TEACHING' WHEN FALSE THEN 'NON_TEACHING' ELSE 'UNASSIGNED' END",
      'd',
      { en: 'Staff type', bn: 'কর্মীর ধরন' },
      { enumValues: ['TEACHING', 'NON_TEACHING', 'UNASSIGNED'] },
    ),
    field(
      'status',
      T.ENUM,
      'u.status',
      'u',
      { en: 'Status', bn: 'অবস্থা' },
      { enumValues: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
    ),
    field(
      'joining_date',
      T.DATE,
      'sp.joining_date',
      'sp',
      { en: 'Joining date', bn: 'যোগদানের তারিখ' },
      { sensitivity: FieldSensitivity.PERSONAL },
    ),
    field('department', T.TEXT, 'hr.department', 'hr', { en: 'Department', bn: 'বিভাগ' }),
    field(
      'religion',
      T.TEXT,
      'hr.religion',
      'hr',
      { en: 'Religion', bn: 'ধর্ম' },
      { sensitivity: FieldSensitivity.SENSITIVE },
    ),
  ],
  measures: [
    measure('staff', AggregateFn.COUNT_DISTINCT, 'sp.id', 'sp', T.NUMBER, {
      en: 'Staff',
      bn: 'কর্মী',
    }),
  ],
};
