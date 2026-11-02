import {
  REPORT_DEFINITION_SCHEMA_VERSION,
  ReportLayoutType,
  type ReportDefinitionJson,
  type ReportSubjectArea,
  UserRole,
} from '@biddaloy/shared';

/** The roles every system report is open to; a report adds more where it makes sense. */
export const FINANCE_AND_LEADERS: readonly string[] = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
];

/**
 * A ready report, as the seeder stores it. `key` doubles as `system_template_key`: a school's copy is
 * found by it, and a copy someone customises keeps it for lineage (Epic 8.15 D12).
 */
export interface SystemReportDef {
  key: string;
  nameEn: string;
  nameBn: string;
  /** One plain line of what it shows, in the glossary's words (D21). */
  descriptionEn: string;
  descriptionBn: string;
  folder: string;
  visibleRoles: readonly string[];
  definition: ReportDefinitionJson;
}

/** A definition with the boring parts filled in, so each system report reads as just its choices. */
export function definitionFor(
  area: ReportSubjectArea,
  parts: Pick<ReportDefinitionJson, 'parameters' | 'dataset' | 'layout'> &
    Partial<Pick<ReportDefinitionJson, 'drill' | 'page'>>,
  titles: { en: string; bn: string },
): ReportDefinitionJson {
  return {
    schema: REPORT_DEFINITION_SCHEMA_VERSION,
    subjectArea: area,
    parameters: parts.parameters,
    dataset: parts.dataset,
    layout: parts.layout ?? { type: ReportLayoutType.TABLE },
    page: parts.page ?? { title_en: titles.en, title_bn: titles.bn, orientation: 'portrait' },
    drill: parts.drill ?? [],
    calculated: [],
    format: [],
  };
}
