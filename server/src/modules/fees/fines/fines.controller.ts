import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Inject,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { FamilyAccessService } from '../../students/family-access.service';
import { TeacherScopeService } from '../../classes/teacher-scope.service';
import { FinesService } from './fines.service';
import {
  LogFineDto,
  LogFineResultDto,
  WaiveFineDto,
  WaiveFineResultDto,
  QueryFinesDto,
} from './dto/fines.dto';
import { toFamilyFine } from '../dto/family.dto';
import { Permission, isGuardianRole } from '@biddaloy/shared';
import { JwtPayload } from '@biddaloy/shared';

@ApiTags('fines')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FinesController {
  constructor(
    @Inject(FinesService) private readonly finesService: FinesService,
    @Inject(FamilyAccessService) private readonly familyAccess: FamilyAccessService,
    @Inject(TeacherScopeService) private readonly teacherScope: TeacherScopeService,
  ) {}

  @Post('fees/fines')
  @RequirePermissions(Permission.FEE_GENERATE)
  logFine(
    @Body() dto: LogFineDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<LogFineResultDto> {
    return this.finesService.logFine(
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  @Post('fees/fines/:id/waive')
  @RequirePermissions(Permission.FEE_APPROVE)
  @ApiOperation({
    summary:
      'Waive a fine bill. Kept for existing clients; same as `POST /fees/bills/:id/waive`. Needs a fees.discount approval token.',
  })
  waiveFine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WaiveFineDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<WaiveFineResultDto> {
    return this.finesService.waiveBill(
      id,
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  @Post('fees/bills/:id/waive')
  @RequirePermissions(Permission.FEE_APPROVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Write off an open bill of any fee type, in full or in part (MON-08). Needs a fees.discount approval token (X-Approval-Token); the service consumes it after every check passes.',
  })
  @ApiOkResponse({ type: WaiveFineResultDto })
  waiveBill(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WaiveFineDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Promise<WaiveFineResultDto> {
    return this.finesService.waiveBill(
      id,
      dto,
      tenant.id,
      user.sub,
      request as unknown as {
        headers: Record<string, string | string[] | undefined>;
        currentTenant?: { id: string };
        user?: { sub: string };
      },
    );
  }

  @Get('fees/fines')
  @RequirePermissions(Permission.FEE_READ)
  async listFines(
    @Query() query: QueryFinesDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    if (!isGuardianRole(tenant.role)) {
      // [75.6-d] TEACHER: only current-year assigned sections (`null` = unrestricted staff).
      // [83.0] D5 — teaching-only on purpose; no `includeCoordinated`.
      const scoped = await this.teacherScope.scopedStudentIds({
        role: tenant.role,
        userId: user.sub,
        tenantId: tenant.id,
      });
      return this.finesService.listFines(query, tenant.id, scoped ?? undefined);
    }
    const restrictToStudentIds = await this.familyAccess.getLinkedStudentIds(
      tenant.role,
      user.sub,
      tenant.id,
    );
    const page = await this.finesService.listFines(query, tenant.id, restrictToStudentIds);
    return { ...page, items: page.items.map(toFamilyFine) };
  }
}
