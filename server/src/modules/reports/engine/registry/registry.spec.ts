import { describe, expect, it } from 'vitest';
import { FieldSensitivity, ReportFieldType, ReportSubjectArea } from '@biddaloy/shared';
import { ALL_AREAS } from './areas';
import { ReportRegistry, assertRegistryValid } from './registry';
import type { FieldDef, SubjectAreaDef } from './registry.types';

const students = studentsArea();

function studentsArea(): SubjectAreaDef {
  return {
    key: ReportSubjectArea.STUDENTS,
    root: {
      alias: 's',
      table: 'students',
      tenantColumn: 'tenant_id',
      softDeleteColumn: 'deleted_at',
    },
    joins: [],
    fields: [],
    measures: [],
  };
}

const nameField: FieldDef = {
  key: 'name',
  labelEn: 'Name',
  labelBn: 'নাম',
  type: ReportFieldType.TEXT,
  sql: 's.full_name',
  entity: 's',
  filterable: true,
  groupable: false,
  sortable: true,
  sensitivity: FieldSensitivity.PERSONAL,
};

describe('report registry', () => {
  it('the six stub areas validate', () => {
    expect(() => assertRegistryValid(ALL_AREAS)).not.toThrow();
    expect(ALL_AREAS.map((a) => a.key)).toEqual([
      'STUDENTS',
      'STAFF',
      'PUBLIC_EXAMS',
      'FEES',
      'PAYMENTS',
      'ATTENDANCE',
    ]);
  });

  it('a field key used twice in one area throws', () => {
    const area = { ...students, fields: [nameField, { ...nameField }] };
    expect(() => assertRegistryValid([area])).toThrow(/field key "name" is not unique/);
  });

  it('a field on an entity the area cannot reach throws', () => {
    const area = { ...students, fields: [{ ...nameField, entity: 'g' }] };
    expect(() => assertRegistryValid([area])).toThrow(/cannot reach/);
  });

  it('an entity with no tenant column and no tenantVia throws', () => {
    const area: SubjectAreaDef = {
      ...students,
      root: { alias: 'x', table: 'things', tenantColumn: null },
    };
    expect(() => assertRegistryValid([area])).toThrow(/no tenant column/);
  });

  it('a tenantVia that points at a table without tenant_id throws', () => {
    const area: SubjectAreaDef = {
      ...students,
      root: { alias: 'x', table: 'things', tenantColumn: null, tenantVia: 'y' },
      joins: [
        {
          from: 'x',
          to: { alias: 'y', table: 'more_things', tenantColumn: null, tenantVia: 'x' },
          on: 'x.y_id = y.id',
          kind: 'inner',
        },
      ],
    };
    expect(() => assertRegistryValid([area])).toThrow(/no tenant column/);
  });

  it('a join that starts from an unknown alias throws', () => {
    const area: SubjectAreaDef = {
      ...students,
      joins: [
        {
          from: 'zzz',
          to: { alias: 'g', table: 'guardians', tenantColumn: 'tenant_id' },
          on: 'zzz.id = g.id',
          kind: 'left',
        },
      ],
    };
    expect(() => assertRegistryValid([area])).toThrow(/unknown alias "zzz"/);
  });

  it('an alias used twice throws', () => {
    const area: SubjectAreaDef = {
      ...students,
      joins: [
        {
          from: 's',
          to: { alias: 's', table: 'guardians', tenantColumn: 'tenant_id' },
          on: 's.id = s.id',
          kind: 'left',
        },
      ],
    };
    expect(() => assertRegistryValid([area])).toThrow(/used twice/);
  });

  it('an area defined twice throws', () => {
    expect(() => assertRegistryValid([students, studentsArea()])).toThrow(/defined twice/);
  });

  it('student_fees is school-scoped through its joined student', () => {
    const fees = ALL_AREAS.find((a) => a.key === ReportSubjectArea.FEES);
    expect(fees?.root.tenantColumn).toBeNull();
    expect(fees?.root.tenantVia).toBe('s');
    expect(fees?.joins[0]?.to.tenantColumn).toBe('tenant_id');
  });

  it('a field key that is not snake_case throws (keys become column names)', () => {
    const area = { ...students, fields: [{ ...nameField, key: 'bad key"' }] };
    expect(() => assertRegistryValid([area])).toThrow(/not snake_case/);
  });

  it('a joined entity without its own tenant_id throws', () => {
    const area: SubjectAreaDef = {
      ...students,
      joins: [
        {
          from: 's',
          to: { alias: 'x', table: 'things', tenantColumn: null, tenantVia: 'elsewhere' },
          on: 'x.s_id = s.id',
          kind: 'left',
        },
      ],
    };
    expect(() => assertRegistryValid([area])).toThrow(/needs its own tenant_id/);
  });

  it('a lookup table without tenant_id is fine when it joins from a school-scoped table', () => {
    const area: SubjectAreaDef = {
      ...students,
      joins: [
        {
          from: 's',
          to: { alias: 'u', table: 'users', tenantColumn: null, tenantVia: 's' },
          on: 'u.id = s.user_id',
          kind: 'left',
        },
      ],
    };
    expect(() => assertRegistryValid([area])).not.toThrow();
  });

  it('a root scoped through a LEFT join to its tenant table throws (the join must be inner)', () => {
    const area: SubjectAreaDef = {
      ...students,
      root: { alias: 'x', table: 'things', tenantColumn: null, tenantVia: 's' },
      joins: [{ from: 'x', to: students.root, on: 'x.s_id = s.id', kind: 'left' }],
    };
    expect(() => assertRegistryValid([area])).toThrow(/must be an inner join/);
  });

  it('the registry service looks areas up and refuses to start when invalid', () => {
    const registry = new ReportRegistry();
    expect(registry.area(ReportSubjectArea.STUDENTS)?.root.table).toBe('enrollments');
    expect(registry.areas()).toHaveLength(6);
    expect(() => registry.onModuleInit()).not.toThrow();
  });

  it('exposes frozen definitions, so a caller cannot edit the semantic layer', () => {
    const area = new ReportRegistry().area(ReportSubjectArea.STUDENTS);
    expect(Object.isFrozen(area)).toBe(true);
    expect(Object.isFrozen(area?.root)).toBe(true);
  });
});
