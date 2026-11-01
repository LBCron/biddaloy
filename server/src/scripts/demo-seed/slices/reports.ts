import { ReportDefinitionStatus, ReportRunKind, ReportRunStatus } from '@biddaloy/shared';
import { ReportDefinitionVersion } from '../../../modules/reports/entities/report-definition-version.entity';
import { ReportDefinition } from '../../../modules/reports/entities/report-definition.entity';
import { ReportRun } from '../../../modules/reports/entities/report-run.entity';
import { seedSystemReports } from '../../../modules/reports/system/system-reports.seeder';
import { studentList } from '../../../modules/reports/system/student-list.definition';
import type { DemoSlice } from '../context';
import { orgIds } from './org';

/**
 * [8.15.32] The ready-made reports in every branch (the same seeder a new school's preset apply uses),
 * one custom draft nobody has published, and two finished runs, so the Reports hub, its usage page
 * and the designer's list are never empty in the demo.
 *
 * Run rows carry no data (D8), only who ran what and how big the answer was. `row_count` and
 * `duration_ms` are drawn from `ctx.rng`, never measured.
 */
export const slice: DemoSlice = {
  name: 'reports',
  covers: [ReportDefinition, ReportDefinitionVersion, ReportRun],
  async run(ctx) {
    const { tenants, adminUserId } = orgIds(ctx);
    for (const t of tenants) {
      await seedSystemReports(ctx.ds.manager, t.id, adminUserId);

      await ctx.ds.getRepository(ReportDefinition).save({
        tenant_id: t.id,
        key: 'class-roll-draft',
        name_en: 'Class roll (draft)',
        name_bn: 'শ্রেণির হাজিরা তালিকা (খসড়া)',
        folder: 'Students',
        status: ReportDefinitionStatus.DRAFT,
        visible_roles: [],
        draft: studentList.definition,
        current_version_id: null,
        created_by: adminUserId,
      });

      const published = await ctx.ds
        .getRepository(ReportDefinition)
        .find({ where: { tenant_id: t.id, status: ReportDefinitionStatus.PUBLISHED } });
      const runs = published
        .filter((d) => d.current_version_id !== null)
        .slice(0, 2)
        .map((d) => ({
          tenant_id: t.id,
          definition_version_id: d.current_version_id,
          source_key: null,
          kind: ReportRunKind.RUN,
          status: ReportRunStatus.DONE,
          format: null,
          params: {},
          row_count: ctx.rng.number.int({ min: 40, max: 900 }),
          duration_ms: ctx.rng.number.int({ min: 60, max: 900 }),
          run_by: adminUserId,
        }));
      await ctx.ds.getRepository(ReportRun).save(runs);
    }
  },
};
