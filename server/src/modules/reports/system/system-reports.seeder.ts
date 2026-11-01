import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { REPORT_DEFINITION_SCHEMA_VERSION, ReportDefinitionStatus } from '@biddaloy/shared';
import { ReportDefinitionVersion } from '../entities/report-definition-version.entity';
import { ReportDefinition } from '../entities/report-definition.entity';
import { SYSTEM_REPORTS } from './system-reports';

/**
 * Puts the system reports into one school as published version 1 (Epic 8.15 D12). Safe to call any number of
 * times: a report is created only when the school has none with that `system_template_key`, so a copy the
 * school has edited, cloned or archived is never touched. Returns how many it created.
 */
export async function seedSystemReports(
  manager: EntityManager,
  tenantId: string,
  userId: string | null,
): Promise<number> {
  const definitions = manager.getRepository(ReportDefinition);
  const versions = manager.getRepository(ReportDefinitionVersion);
  let created = 0;
  for (const report of SYSTEM_REPORTS) {
    const existing = await definitions.exists({
      where: { tenant_id: tenantId, system_template_key: report.key },
      withDeleted: true,
    });
    if (existing) continue;
    // A school's own report may already use the key; the ready one then waits until that is renamed.
    const keyTaken = await definitions.exists({
      where: { tenant_id: tenantId, key: report.key, deleted_at: IsNull() },
    });
    if (keyTaken) continue;

    const definition = await definitions.save(
      definitions.create({
        tenant_id: tenantId,
        key: report.key,
        name_en: report.nameEn,
        name_bn: report.nameBn,
        folder: report.folder,
        status: ReportDefinitionStatus.PUBLISHED,
        visible_roles: [...report.visibleRoles],
        draft: report.definition,
        system_template_key: report.key,
        created_by: userId,
      }),
    );
    const version = await versions.save(
      versions.create({
        tenant_id: tenantId,
        definition_id: definition.id,
        version: 1,
        definition: report.definition,
        schema_version: REPORT_DEFINITION_SCHEMA_VERSION,
        published_by: userId,
      }),
    );
    await definitions.update({ id: definition.id }, { current_version_id: version.id });
    created++;
  }
  return created;
}

/** The injectable form, for code that has a `DataSource` and no open transaction. */
@Injectable()
export class SystemReportsSeeder {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  seed(tenantId: string, userId: string | null): Promise<number> {
    return this.dataSource.transaction((manager) => seedSystemReports(manager, tenantId, userId));
  }
}
