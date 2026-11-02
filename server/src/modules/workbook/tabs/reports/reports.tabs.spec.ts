import { describe, expect, it } from 'vitest';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { reportDefinitionVersionsTab } from './report-definition-versions.tab';
import { reportDefinitionsTab } from './report-definitions.tab';
import { reportSchedulesTab } from './report-schedules.tab';

const ID = '00000000-0000-4000-8000-000000000001';

/** An import context whose only known report is `student-list`. */
const ctx: ImportContext = {
  tenantId: 'school-b',
  ref: (tab, key) =>
    tab === 'report_definitions' && key === 'student-list' ? 'def-id-b' : undefined,
  warn: () => undefined,
};

describe('report_definitions tab', () => {
  const cells = (over: Record<string, string> = {}) => ({
    id: ID,
    key: 'student-list',
    name_en: 'Student list',
    name_bn: 'শিক্ষার্থীর তালিকা',
    folder: 'Students',
    status: 'PUBLISHED',
    visible_roles: '["ADMIN","ACCOUNTANT"]',
    system_template_key: '',
    draft: '',
    ...over,
  });

  it('reads a definition, keeping the Bangla name and the role list', () => {
    const out = reportDefinitionsTab.fromRow(cells(), 2, ctx);
    if (!('row' in out)) throw new Error('row expected');
    expect(out.row).toMatchObject({
      key: 'student-list',
      name_bn: 'শিক্ষার্থীর তালিকা',
      visible_roles: ['ADMIN', 'ACCOUNTANT'],
      folder: 'Students',
      system_template_key: null,
      draft: null,
    });
  });

  it('keeps the editable draft as JSON, and none when there is none', () => {
    const withDraft = reportDefinitionsTab.fromRow(
      cells({ draft: JSON.stringify({ schema: 1, subjectArea: 'STUDENTS' }) }),
      2,
      ctx,
    );
    expect('row' in withDraft && withDraft.row.draft).toEqual({
      schema: 1,
      subjectArea: 'STUDENTS',
    });
  });

  it('rejects visible_roles that is not a list of names', () => {
    const out = reportDefinitionsTab.fromRow(cells({ visible_roles: '{"ADMIN":true}' }), 2, ctx);
    expect('errors' in out && out.errors[0]?.column).toBe('visible_roles');
  });

  it('rejects an unknown status', () => {
    const out = reportDefinitionsTab.fromRow(cells({ status: 'LIVE' }), 2, ctx);
    expect('errors' in out && out.errors[0]?.column).toBe('status');
  });

  it('does not export current_version_id (the versions tab restores that link)', () => {
    expect(reportDefinitionsTab.columns.map((c) => c.key)).not.toContain('current_version_id');
    expect(reportDefinitionsTab.excluded).toContain('current_version_id');
  });

  it('never deletes a definition just because the file leaves it out', () => {
    expect(reportDefinitionsTab.deleteByAbsence).toBe(false);
  });
});

describe('report_definition_versions tab', () => {
  const definitionJson = { schema: 1, subjectArea: 'STUDENTS' };
  const cells = (over: Record<string, string> = {}) => ({
    id: ID,
    report: 'student-list',
    version: '2',
    definition: JSON.stringify(definitionJson),
    schema_version: '1',
    published_at: '2027-03-01T00:00:00.000Z',
    is_current: 'true',
    ...over,
  });

  it('resolves the report and keeps the definition JSON as it was', () => {
    const out = reportDefinitionVersionsTab.fromRow(cells(), 2, ctx);
    if (!('row' in out)) throw new Error('row expected');
    expect(out.row).toMatchObject({ definition_id: 'def-id-b', version: 2, is_current: true });
    expect(out.row.definition).toEqual(definitionJson);
  });

  it('errors on a report that was not restored', () => {
    const out = reportDefinitionVersionsTab.fromRow(cells({ report: 'nope' }), 2, ctx);
    expect('errors' in out && out.errors[0]?.column).toBe('report');
  });

  it('a row and an entity for the same version share one key', () => {
    const out = reportDefinitionVersionsTab.fromRow(cells(), 2, ctx);
    if (!('row' in out)) throw new Error('row expected');
    const entity = Object.assign(new (reportDefinitionVersionsTab.entity as new () => object)(), {
      version: 2,
      report_definition: { key: 'student-list' },
    });
    expect(reportDefinitionVersionsTab.keyOf(entity as never)).toBe(
      reportDefinitionVersionsTab.keyOf(out.row),
    );
  });

  describe('diffFields', () => {
    const row = (is_current: boolean) => {
      const out = reportDefinitionVersionsTab.fromRow(
        cells({ is_current: String(is_current) }),
        2,
        ctx,
      );
      if (!('row' in out)) throw new Error('row expected');
      return out.row;
    };
    const existing = (currentVersionId: string | null, definition: unknown) =>
      ({
        id: 'v2',
        definition,
        report_definition: { current_version_id: currentVersionId },
      }) as never;

    it('reports is_current when an identical version becomes the current one', () => {
      const r = row(true);
      expect(reportDefinitionVersionsTab.diffFields(r, existing('v1', r.definition))).toEqual([
        'is_current',
      ]);
    });

    it('reports nothing when the version is already current and the definition matches', () => {
      const r = row(true);
      expect(reportDefinitionVersionsTab.diffFields(r, existing('v2', r.definition))).toEqual([]);
    });

    it('reports the definition when it differs', () => {
      expect(reportDefinitionVersionsTab.diffFields(row(false), existing('v1', {}))).toEqual([
        'definition',
      ]);
    });
  });

  it('never deletes a published version', async () => {
    expect(reportDefinitionVersionsTab.deleteByAbsence).toBe(false);
    await expect(reportDefinitionVersionsTab.remove({} as never, {} as never)).rejects.toThrow(
      /immutable/,
    );
  });
});

describe('report_schedules tab', () => {
  const cells = (over: Record<string, string> = {}) => ({
    id: ID,
    report: 'student-list',
    frequency: 'WEEKLY',
    day_of_week: '1',
    day_of_month: '',
    local_time: '08:30',
    params: '{"class":"six"}',
    recipient_roles: '["ADMIN"]',
    format: 'XLSX',
    active: 'true',
    ...over,
  });

  it('reads a weekly schedule', () => {
    const out = reportSchedulesTab.fromRow(cells(), 2, ctx);
    if (!('row' in out)) throw new Error('row expected');
    expect(out.row).toMatchObject({
      definition_id: 'def-id-b',
      frequency: 'WEEKLY',
      day_of_week: 1,
      day_of_month: null,
      local_time: '08:30',
      recipient_roles: ['ADMIN'],
      params: { class: 'six' },
    });
  });

  it.each(['8:30', '24:00', '08:60', 'noon'])('rejects the time %s', (time) => {
    const out = reportSchedulesTab.fromRow(cells({ local_time: time }), 2, ctx);
    expect('errors' in out && out.errors[0]?.column).toBe('local_time');
  });

  it('errors on a report that was not restored', () => {
    const out = reportSchedulesTab.fromRow(cells({ report: 'nope' }), 2, ctx);
    expect('errors' in out && out.errors[0]?.column).toBe('report');
  });

  it('exports the report key, never the report id', () => {
    const exportCtx: ExportContext = { keyOf: (_tab, id) => `key-of-${id}` };
    const row = reportSchedulesTab.toRow(
      { id: ID, definition_id: 'd1', frequency: 'DAILY', local_time: '07:00' } as never,
      exportCtx,
    );
    expect(row.report).toBe('key-of-d1');
  });

  it('a row and an entity for the same schedule share one key', () => {
    const out = reportSchedulesTab.fromRow(cells(), 2, ctx);
    if (!('row' in out)) throw new Error('row expected');
    const entity = Object.assign(new (reportSchedulesTab.entity as new () => object)(), {
      frequency: 'WEEKLY',
      day_of_week: 1,
      day_of_month: null,
      local_time: '08:30',
      report_definition: { key: 'student-list' },
    });
    expect(reportSchedulesTab.keyOf(entity as never)).toBe(reportSchedulesTab.keyOf(out.row));
  });
});
