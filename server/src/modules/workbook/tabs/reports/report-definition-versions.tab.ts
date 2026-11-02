import { IsNull, type EntityManager } from 'typeorm';
import type { ReportDefinitionJson } from '@biddaloy/shared';
import { ReportDefinition } from '../../../reports/entities/report-definition.entity';
import { ReportDefinitionVersion } from '../../../reports/entities/report-definition-version.entity';
import { fromCell } from '../../codec/cell-format';
import type {
  ColumnSpec,
  ExportContext,
  ImportContext,
  RowError,
  TabSpec,
} from '../../codec/tab-spec';

/**
 * The `report_definition_versions` tab ([8.15.12], Epic 8.15 D3): every published,
 * immutable version of a report.
 *
 * IMMUTABLE: a database trigger rejects UPDATE on this table, and a published version
 * must never change (a run or snapshot points at it). A restore therefore only INSERTS
 * versions; a row that matches an existing version but carries different content is an
 * error, never a silent skip and never an update attempt.
 *
 * `is_current` is a sheet-only column: it marks the version its report points at. Right
 * after inserting the version, `upsert` sets `report_definitions.current_version_id` in
 * the same restore transaction, so there is no deferred "link it later" step to lose.
 */
export interface ReportDefinitionVersionRow {
  id: string;
  definition_id: string;
  report_key: string;
  version: number;
  definition: ReportDefinitionJson;
  schema_version: number;
  published_at: Date;
  is_current: boolean;
}

const label = (en: string, bn: string) => ({ en, bn });
const columns: readonly ColumnSpec[] = [
  { key: 'id', type: 'uuid', required: true, label: label('ID', 'আইডি') },
  {
    key: 'report',
    type: 'ref',
    ref: 'report_definitions',
    required: true,
    label: label('Report', 'রিপোর্ট'),
  },
  { key: 'version', type: 'int', required: true, label: label('Version', 'সংস্করণ') },
  { key: 'definition', type: 'json', required: true, label: label('Definition', 'সংজ্ঞা') },
  {
    key: 'schema_version',
    type: 'int',
    required: true,
    label: label('Schema version', 'স্কিমা সংস্করণ'),
  },
  {
    key: 'published_at',
    type: 'datetime',
    required: true,
    label: label('Published at', 'প্রকাশের সময়'),
  },
  {
    key: 'is_current',
    type: 'bool',
    required: true,
    label: label('Current version', 'বর্তমান সংস্করণ'),
  },
];

const excluded: readonly string[] = [
  'definition_id', // exported instead as the `report` ref column
  'published_by', // audit "who published" field, not needed for restore fidelity
];

export const reportDefinitionVersionsTab: TabSpec<
  ReportDefinitionVersion,
  ReportDefinitionVersionRow
> = {
  name: 'report_definition_versions',
  entity: ReportDefinitionVersion,
  excluded,
  dependsOn: ['report_definitions'],
  columns,
  naturalKey: ['report', 'version'],
  // Published versions are history that runs and snapshots refer to; a restore never removes one.
  deleteByAbsence: false,

  load(tenantId: string, m: EntityManager): Promise<ReportDefinitionVersion[]> {
    return m.find(ReportDefinitionVersion, {
      // A soft-deleted report is absent from the report_definitions export, so its versions
      // would make `keyOf` throw; leave them out.
      where: { tenant_id: tenantId, report_definition: { deleted_at: IsNull() } },
      relations: ['report_definition'],
    });
  },

  toRow(entity: ReportDefinitionVersion, ctx: ExportContext): Record<string, unknown> {
    return {
      id: entity.id,
      report: ctx.keyOf('report_definitions', entity.definition_id),
      version: entity.version,
      definition: entity.definition,
      schema_version: entity.schema_version,
      published_at: entity.published_at,
      is_current: entity.report_definition?.current_version_id === entity.id,
    };
  },

  fromRow(
    cells: Record<string, string>,
    rowNo: number,
    ctx: ImportContext,
  ): { row: ReportDefinitionVersionRow } | { errors: RowError[] } {
    const errors: RowError[] = [];
    const v: Record<string, unknown> = {};
    for (const column of columns) {
      const result = fromCell(column, cells[column.key] ?? '', 'report_definition_versions', rowNo);
      if ('error' in result) errors.push(result.error);
      else v[column.key] = result.value;
    }
    if (errors.length > 0) return { errors };

    const reportKey = v.report as string;
    const definitionId = ctx.ref('report_definitions', reportKey);
    if (!definitionId) {
      return {
        errors: [
          {
            tab: 'report_definition_versions',
            row: rowNo,
            column: 'report',
            message: `Column "report": no report with the key "${reportKey}" was found.`,
            severity: 'error',
            value: reportKey,
          },
        ],
      };
    }

    const definition = v.definition;
    if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
      return {
        errors: [
          {
            tab: 'report_definition_versions',
            row: rowNo,
            column: 'definition',
            message: 'Column "definition": expected a JSON object.',
            severity: 'error',
          },
        ],
      };
    }

    return {
      row: {
        id: v.id as string,
        definition_id: definitionId,
        report_key: reportKey,
        version: v.version as number,
        definition: v.definition as ReportDefinitionJson,
        schema_version: v.schema_version as number,
        published_at: v.published_at as Date,
        is_current: v.is_current as boolean,
      },
    };
  },

  keyOf(x: ReportDefinitionVersionRow | ReportDefinitionVersion): string {
    if (x instanceof ReportDefinitionVersion) {
      return `${x.report_definition?.key ?? ''}|${x.version}`;
    }
    return `${x.report_key}|${x.version}`;
  },

  diffFields(row: ReportDefinitionVersionRow, existing: ReportDefinitionVersion): string[] {
    // `published_at` and `id` are not part of "has it changed", but becoming the report's current
    // version is: restore moves `current_version_id` even when the definition is identical.
    const changed: string[] = [];
    if (JSON.stringify(row.definition) !== JSON.stringify(existing.definition)) {
      changed.push('definition');
    }
    if (row.is_current && existing.report_definition?.current_version_id !== existing.id) {
      changed.push('is_current');
    }
    return changed;
  },

  async upsert(
    row: ReportDefinitionVersionRow,
    existing: ReportDefinitionVersion | null,
    tenantId: string,
    m: EntityManager,
  ): Promise<ReportDefinitionVersion> {
    let version: ReportDefinitionVersion;
    if (existing) {
      // Published versions never change (D3; DB trigger). Different content is a hard error.
      if (JSON.stringify(row.definition) !== JSON.stringify(existing.definition)) {
        throw new Error(
          `Cannot restore report version ${row.report_key} v${row.version}: ` +
            'a published version is immutable and this workbook holds different content for it.',
        );
      }
      version = existing;
    } else {
      version = new ReportDefinitionVersion();
      version.tenant_id = tenantId;
      version.definition_id = row.definition_id;
      version.version = row.version;
      version.definition = row.definition;
      version.schema_version = row.schema_version;
      version.published_at = row.published_at;
      version = await m.save(ReportDefinitionVersion, version);
    }

    // The circular link, closed in the same transaction as the insert.
    if (row.is_current) {
      await m.update(
        ReportDefinition,
        { id: row.definition_id, tenant_id: tenantId },
        { current_version_id: version.id },
      );
    }
    return version;
  },

  async remove(_entity: ReportDefinitionVersion, _m: EntityManager): Promise<void> {
    // Unreachable while `deleteByAbsence` is false; refuse loudly if that ever changes.
    throw new Error('Published report versions are immutable and cannot be removed.');
  },
};
