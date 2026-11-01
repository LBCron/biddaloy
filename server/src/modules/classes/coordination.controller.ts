import { Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { SETTINGS_RATE_LIMIT } from '../../rate-limit';
import { CoordinationService } from './coordination.service';
import {
  CoordinationOverviewDto,
  CoordinationOverviewQueryDto,
  NotifyCoordinatedTeachersDto,
  NotifyCoordinatedTeachersResultDto,
} from './dto/coordination.dto';

/**
 * [83.3.2] Academics › My coordination (Epic 83 D9, D25). `COORDINATION_VIEW` is TEACHER-only;
 * the data is scoped by the caller's own `coordinator_assignments` rows, so a teacher with none
 * gets an empty overview (Rule 2) and cannot notify anyone.
 */
@ApiTags('coordination')
@ApiTenantAuth()
@Controller('coordination')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.COORDINATION_VIEW)
export class CoordinationController {
  constructor(private readonly coordination: CoordinationService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Per coordinated class: sections without attendance on the date, pending mark grids, teachers.',
  })
  @ApiOkResponse({ type: CoordinationOverviewDto })
  overview(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Query() query: CoordinationOverviewQueryDto,
  ): Promise<CoordinationOverviewDto> {
    return this.coordination.overview(user.sub, tenant.id, query.date);
  }

  @Post('alerts')
  // Same per-minute limit as `POST /attention/manual`; the daily cap is shared (it is one path).
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  // Rule 25: a resent Send with the same Idempotency-Key sends one reminder.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Send one in-app reminder to chosen teachers of coordinated classes.' })
  @ApiCreatedResponse({ type: NotifyCoordinatedTeachersResultDto })
  notify(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: NotifyCoordinatedTeachersDto,
  ): Promise<NotifyCoordinatedTeachersResultDto> {
    return this.coordination.notify(user.sub, tenant.id, dto);
  }
}
