import { describe, expect, it } from 'vitest';

import {
  AggregateFn,
  ExportFormat,
  FieldSensitivity,
  FilterOp,
  ReportDefinitionStatus,
  ReportFieldType,
  ReportLayoutType,
  ReportParamType,
  ReportRunKind,
  ReportRunStatus,
  ReportScheduleFrequency,
  ReportSubjectArea,
} from './reports';

const ALL = {
  ReportLayoutType,
  ReportFieldType,
  FieldSensitivity,
  ReportParamType,
  FilterOp,
  AggregateFn,
  ExportFormat,
  ReportRunStatus,
  ReportRunKind,
  ReportDefinitionStatus,
  ReportScheduleFrequency,
  ReportSubjectArea,
};

describe('report enums', () => {
  it.each(Object.entries(ALL))('%s: every value equals its key', (_name, obj) => {
    for (const [key, value] of Object.entries(obj)) expect(value).toBe(key);
  });

  it('have stable string values', () => {
    expect(Object.values(ReportLayoutType)).toEqual(['TABLE', 'GROUPED', 'CROSSTAB', 'CHART']);
    expect(Object.values(ReportFieldType)).toEqual([
      'TEXT',
      'NUMBER',
      'MONEY',
      'PERCENT',
      'DATE',
      'ENUM',
      'BOOLEAN',
    ]);
    expect(Object.values(FieldSensitivity)).toEqual([
      'PUBLIC',
      'PERSONAL',
      'CONTACT',
      'FINANCIAL',
      'SENSITIVE',
    ]);
    expect(Object.values(ReportParamType)).toEqual([
      'ACADEMIC_YEAR',
      'CLASS',
      'SECTION',
      'DATE',
      'DATE_RANGE',
      'ENUM',
      'TEXT',
    ]);
    expect(Object.values(FilterOp)).toHaveLength(12);
    expect(Object.values(AggregateFn)).toEqual([
      'COUNT',
      'COUNT_DISTINCT',
      'SUM',
      'AVG',
      'MIN',
      'MAX',
    ]);
    expect(Object.values(ExportFormat)).toEqual(['CSV', 'XLSX']);
    expect(Object.values(ReportRunStatus)).toEqual([
      'QUEUED',
      'RUNNING',
      'DONE',
      'FAILED',
      'EXPIRED',
    ]);
    expect(Object.values(ReportRunKind)).toEqual([
      'PREVIEW',
      'RUN',
      'EXPORT',
      'SCHEDULED',
      'SNAPSHOT',
    ]);
    expect(Object.values(ReportDefinitionStatus)).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
    expect(Object.values(ReportScheduleFrequency)).toEqual(['DAILY', 'WEEKLY', 'MONTHLY']);
    expect(Object.values(ReportSubjectArea)).toEqual([
      'STUDENTS',
      'STAFF',
      'PUBLIC_EXAMS',
      'FEES',
      'PAYMENTS',
      'ATTENDANCE',
    ]);
  });
});
