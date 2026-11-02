import type { EntityManager } from 'typeorm';
import { ReportDefinitionStatus, type ReportDefinitionJson } from '@biddaloy/shared';
import { ReportDefinition } from '../../../reports/entities/report-definition.entity';
import { fromCell } from '../../codec/cell-format';
import type { ColumnSpec, RowError, TabSpec } from '../../codec/tab-spec';

/**
 * The `report_definitions` tab ([8.15.12], Epic 8.15 D3): a tenant's reports.
 *
 * `current_version_id` is NOT a column here. A definition and its versions point at
 * each other, so the pointer is restored by the versions tab (`is_current`) in the
 * same transaction, right after the version row exists (same shape as print templates).
 * The report `key` is its natural key and what the other two report tabs refer to.
 */
export interface ReportDefinitionRow {
  id: string;
  key: string;
  name_en: string;
  name_bn: string;
  folder: string | null;
  status: ReportDefinitionStatus;
  visible_roles: string[];
  system_template_key: string | null;
  draft: ReportDefinitionJson | null;
}

const label = (en: string, bn: string) => ({ en, bn });
const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: label('ID', 'আইডি') },
  { key: 'key', type: 'string', required: true, label: label('Key', 'কী') },
  {
    key: 'name_en',
    type: 'string',
    required: true,
    label: label('Name (English)', 'নাম (ইংরেজি)'),
  },
  { key: 'name_bn', type: 'string', required: true, label: label('Name (Bangla)', 'নাম (বাংলা)') },
  { key: 'folder', type: 'string', label: label('Folder', 'ফোল্ডার') },
  {
    key: 'status',
    type: 'enum',
    required: true,
    enumValues: Object.values(ReportDefinitionStatus),
    label: label('Status', 'অবস্থা'),
  },
  {
    key: 'visible_roles',
    type: 'json',
    required: true,
    label: label('Visible to roles', 'যাদের দেখাবে'),
  },
  { key: 'draft', type: 'json', label: label('Draft', 'খসড়া') },
  {
    key: 'system_template_key',
    type: 'string',
    label: label('System template', 'সিস্টেম টেমপ্লেট'),
  },
];

const excluded: readonly string[] = [
  'current_version_id', // restored by report_definition_versions (is_current), same transaction
  'created_by', // audit "who created" field, not needed for restore fidelity
];

export const reportDefinitionsTab: TabSpec<ReportDefinition, ReportDefinitionRow> = {
  name: 'report_definitions',
  entity: ReportDefinition,
  excluded,
  dependsOn: [],
  columns,
  naturalKey: ['key'],
  // Published versions (immutable), runs and schedules hang off a definition.
  deleteByAbsence: false,

  load(tenantId: string, m: EntityManager): Promise<ReportDefinition[]> {
    return m.find(ReportDefinition, { where: { tenant_id: tenantId } });
  },

  toRow(entity: ReportDefinition): Record<string, unknown> {
    return {
      id: entity.id,
      key: entity.key,
      name_en: entity.name_en,
      name_bn: entity.name_bn,
      folder: entity.folder,
      status: entity.status,
      visible_roles: entity.visible_roles,
      system_template_key: entity.system_template_key,
      draft: entity.draft,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
  ): { row: ReportDefinitionRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const v: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'report_definitions', rowNo);
      if ('error' in result) errors.push(result.error);
      else v[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const roles = v.visible_roles;
    if (!Array.isArray(roles) || roles.some((r) => typeof r !== 'string')) {
      return {
        errors: [
          {
            tab: 'report_definitions',
            row: rowNo,
            column: 'visible_roles',
            message: 'Column "visible_roles": expected a list of role names, e.g. ["ADMIN"].',
            severity: 'error',
          },
        ],
      };
    }

    return {
      row: {
        id: v.id as string,
        key: v.key as string,
        name_en: v.name_en as string,
        name_bn: v.name_bn as string,
        folder: (v.folder as string | undefined) ?? null,
        status: v.status as ReportDefinitionStatus,
        visible_roles: roles as string[],
        system_template_key: (v.system_template_key as string | undefined) ?? null,
        draft: (v.draft as ReportDefinitionJson | undefined) ?? null,
      },
    };
  },

  keyOf(x: ReportDefinitionRow | ReportDefinition): string {
    return x.key;
  },

  diffFields(row: ReportDefinitionRow, existing: ReportDefinition): string[] {
    const changed: string[] = [];
    if (row.name_en !== existing.name_en) changed.push('name_en');
    if (row.name_bn !== existing.name_bn) changed.push('name_bn');
    if (row.folder !== existing.folder) changed.push('folder');
    if (row.status !== existing.status) changed.push('status');
    if (JSON.stringify(row.visible_roles) !== JSON.stringify(existing.visible_roles)) {
      changed.push('visible_roles');
    }
    if (row.system_template_key !== existing.system_template_key) {
      changed.push('system_template_key');
    }
    if (JSON.stringify(row.draft) !== JSON.stringify(existing.draft)) changed.push('draft');
    return changed;
  },

  async upsert(
    row: ReportDefinitionRow,
    existing: ReportDefinition | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ReportDefinition> {
    const definition = existing ?? new ReportDefinition();
    definition.tenant_id = tenantId;
    definition.key = row.key;
    definition.name_en = row.name_en;
    definition.name_bn = row.name_bn;
    definition.folder = row.folder;
    definition.status = row.status;
    definition.visible_roles = row.visible_roles;
    definition.system_template_key = row.system_template_key;
    definition.draft = row.draft;
    // A new definition starts with no published version; the versions tab sets the pointer.
    if (!existing) definition.current_version_id = null;
    return m.save(ReportDefinition, definition);
  },

  async remove(entity: ReportDefinition, m: EntityManager): Promise<void> {
    await m.softRemove(ReportDefinition, entity);
  },
};
