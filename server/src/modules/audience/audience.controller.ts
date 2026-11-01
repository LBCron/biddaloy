import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { AudienceService } from './audience.service';
import { AudienceQueryDto, AudiencePageDto } from './dto/audience-query.dto';

@ApiTags('audience')
@ApiTenantAuth()
@Controller('audience')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.NOTICE_POST)
export class AudienceController {
  constructor(private readonly audience: AudienceService) {}

  @Get('people')
  @ApiOperation({ summary: 'A page of people a notice could reach (basic tabs).' })
  @ApiOkResponse({ type: AudiencePageDto })
  people(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Query() q: AudienceQueryDto,
  ) {
    return this.audience.list(tenant.id, { role: tenant.role, userId: user.sub }, q);
  }
}
