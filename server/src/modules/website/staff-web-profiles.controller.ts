import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { StaffWebProfilesService } from './staff-web-profiles.service';
import { SaveStaffWebProfileDto, StaffWebProfileDto } from './dto/staff-web-profile.dto';

type Tenant = { id: string };

/** [40.3.01] Which teachers the site shows. WEBSITE_MANAGE on every route (D16). */
@ApiTags('website')
@ApiTenantAuth()
@Controller('website/teachers')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.WEBSITE_MANAGE)
export class StaffWebProfilesController {
  constructor(private readonly profiles: StaffWebProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'Teachers and office staff with their website card (or "not shown").' })
  @ApiOkResponse({ type: [StaffWebProfileDto] })
  list(@CurrentTenant() t: Tenant) {
    return this.profiles.list(t.id);
  }

  @Put(':userId')
  @ApiOperation({
    summary:
      'Save one person’s website card. 400 site.profile_invalid (also the 9th featured), 404 site.profile_not_found.',
  })
  @ApiOkResponse({ type: StaffWebProfileDto })
  save(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SaveStaffWebProfileDto,
    @CurrentTenant() t: Tenant,
  ) {
    return this.profiles.upsert(t.id, userId, dto);
  }
}
