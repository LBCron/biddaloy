import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AuthenticatedOnly } from '../auth/decorators/authenticated-only.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PlatformSuperAdminGuard } from '../auth/guards/platform-super-admin.guard';
import {
  PlatformReportUsageDto,
  PlatformReportUsageQueryDto,
} from './delivery/dto/report-delivery.dto';
import { PlatformReportUsageService } from './platform-report-usage.service';

/**
 * [8.15.45] `GET /platform/reports/usage` (D24): platform SUPER_ADMIN only, same guard chain as the
 * other platform controllers (a school-local SUPER_ADMIN and every school role get 403). Aggregates
 * only; no student, guardian or money rows.
 */
@ApiTags('platform')
@ApiTenantAuth()
@Controller('platform/reports')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard, PlatformSuperAdminGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlatformReportUsageController {
  constructor(private readonly service: PlatformReportUsageService) {}

  @AuthenticatedOnly()
  @Get('usage')
  @ApiOperation({
    summary: 'Which reports are used and found useful, counts only. Platform SUPER_ADMIN only.',
  })
  @ApiOkResponse({ type: PlatformReportUsageDto })
  usage(@Query() query: PlatformReportUsageQueryDto): Promise<PlatformReportUsageDto> {
    return this.service.usage(query);
  }
}
