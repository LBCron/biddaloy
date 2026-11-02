import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PlatformSuperAdminGuard } from '../../auth/guards/platform-super-admin.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SchoolsService } from '../../schools/schools.service';
import { WorkbookJob, WorkbookJobKind, WorkbookJobStatus } from '../jobs/workbook-job.entity';
import {
  PlatformBackupHealthResponseDto,
  PlatformSchoolBackupHealthDto,
} from './dto/platform-backup-health.dto';
import { AuthenticatedOnly } from '../../auth/decorators/authenticated-only.decorator';

/**
 * [14.12.3/#617] `GET /platform/backups/health` — platform SUPER_ADMIN only
 * (`PlatformSuperAdminGuard` is required: `@Roles(SUPER_ADMIN)` alone also
 * admits a tenant-local SUPER_ADMIN). It
 * reads across every school rather than one tenant's data, but it still
 * runs the same guard chain as `SchoolsController` (the other cross-tenant
 * SUPER_ADMIN surface): `ContextGuard` requires *some* `X-Tenant-ID` to
 * build `request.currentTenant` for `RolesGuard`, and never applies that
 * tenant's suspension check to a SUPER_ADMIN (see `ContextGuard`'s own
 * comment) — so the caller's own tenant id is the expected value and has
 * no bearing on which schools this reports. Sending no header is a 401,
 * pinned by the e2e spec.
 *
 * One row per school: its current `backup.schedule` setting, the most
 * recent EXPORT job's outcome, the most recent *successful* EXPORT's
 * timestamp, and how much storage its kept backups (EXPORT + SNAPSHOT)
 * occupy. Scoped to `kind: EXPORT` deliberately — a SNAPSHOT is an
 * internal artefact `RestoreService` creates as a safety copy before a
 * restore, not itself a "backup" in the sense this table reports on, so
 * it is excluded from `last_status`/`last_success_at` but still counted
 * in `storage_total_bytes` (it occupies real storage against the same
 * per-tenant cap). A school that has never run an export backup gets
 * `last_success_at: null` / `last_status: null` — the "never" row
 * `BackupHealthTable` renders.
 *
 * Looped per school rather than one aggregate query: `findAll()` returns
 * every school (there is no pagination on this route, matching
 * `SchoolsController.list`), and platform tenant counts are small enough
 * that N+1 sequential lookups here are simpler to read and to test than a
 * hand-rolled `DISTINCT ON` query — worth revisiting if school counts ever
 * make this slow.
 */
@ApiTags('platform')
@Controller('platform/backups')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, PlatformSuperAdminGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformBackupHealthController {
  constructor(
    private readonly schools: SchoolsService,
    @InjectRepository(WorkbookJob) private readonly jobs: Repository<WorkbookJob>,
  ) {}

  @AuthenticatedOnly()
  @Get('health')
  @ApiOperation({
    summary:
      'Per-school backup schedule, last attempt outcome, last success time and storage usage. SUPER_ADMIN only.',
  })
  @ApiOkResponse({ type: PlatformBackupHealthResponseDto })
  async health(): Promise<PlatformBackupHealthResponseDto> {
    const schools = await this.schools.findAll();

    const data: PlatformSchoolBackupHealthDto[] = await Promise.all(
      schools.map(async (school) => {
        const [settings, lastJob, lastSuccess, storageRow] = await Promise.all([
          this.schools.getResolvedSettings(school.id),
          this.jobs.findOne({
            where: { tenant_id: school.id, kind: WorkbookJobKind.EXPORT },
            order: { created_at: 'DESC' },
          }),
          this.jobs.findOne({
            where: {
              tenant_id: school.id,
              kind: WorkbookJobKind.EXPORT,
              status: WorkbookJobStatus.DONE,
            },
            order: { finished_at: 'DESC' },
          }),
          this.jobs
            .createQueryBuilder('job')
            .select('COALESCE(SUM(job.size_bytes), 0)', 'total_bytes')
            .where('job.tenant_id = :tenantId', { tenantId: school.id })
            .andWhere('job.status = :status', { status: WorkbookJobStatus.DONE })
            .getRawOne<{ total_bytes: string }>(),
        ]);

        return {
          school_id: school.id,
          name: school.name,
          schedule: settings.backup?.schedule ?? 'OFF',
          last_status: lastJob?.status ?? null,
          last_success_at: lastSuccess?.finished_at ?? null,
          storage_total_bytes: storageRow?.total_bytes ?? '0',
        };
      }),
    );

    return { data };
  }
}
