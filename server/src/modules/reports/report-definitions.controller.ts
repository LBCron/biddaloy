import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  CatalogueFolderDto,
  CreateReportDefinitionDto,
  ListReportDefinitionsQueryDto,
  ReportDefinitionDetailDto,
  ReportDefinitionDto,
  ReportPresentationDto,
  UpdateReportDefinitionDto,
} from './definitions/dto/report-definition.dto';
import { ReportDefinitionsService } from './definitions/report-definitions.service';

type Tenant = { id: string; role: string };

const viewer = (tenant: Tenant, user: JwtPayload) => ({
  tenantId: tenant.id,
  userId: user.sub,
  role: tenant.role,
});

/** Drops the draft from list rows: the list is names and states, the detail carries the body. */
const summary = <T extends { draft?: unknown }>(row: T): Omit<T, 'draft'> => {
  const { draft: _draft, ...rest } = row;
  return rest;
};

/**
 * [8.15.24] A school's reports: the catalogue anyone who can open reports sees, and the designer's
 * create / edit / publish / copy / archive (REPORTS_DESIGN, ADMIN only, D9). Ready reports are
 * ordinary definitions, so copying one works the same as copying your own.
 */
@ApiTags('reports')
@ApiTenantAuth()
@Controller('reports')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportDefinitionsController {
  constructor(private readonly service: ReportDefinitionsService) {}

  @Get('catalogue')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({ summary: 'Reports your role may run, grouped by folder.' })
  @ApiOkResponse({ type: [CatalogueFolderDto] })
  catalogue(@CurrentTenant() tenant: Tenant, @CurrentUser() user: JwtPayload) {
    return this.service.catalogue(viewer(tenant, user));
  }

  @Get('catalogue/:id/definition')
  @RequirePermissions(Permission.REPORTS_VIEW)
  @ApiOperation({
    summary:
      'How one report looks (questions, layout, page, colours, links), from its published version. Same visibility as the catalogue; no dataset.',
  })
  @ApiOkResponse({ type: ReportPresentationDto })
  presentation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.presentation(viewer(tenant, user), id);
  }

  @Get('definitions')
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOkResponse({ type: [ReportDefinitionDto] })
  async list(@Query() query: ListReportDefinitionsQueryDto, @CurrentTenant() tenant: Tenant) {
    return (await this.service.list(tenant.id, query.status)).map(summary);
  }

  @Post('definitions')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOkResponse({ type: ReportDefinitionDetailDto })
  async create(
    @Body() dto: CreateReportDefinitionDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createDraft(viewer(tenant, user), dto);
  }

  @Get('definitions/:id')
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOkResponse({ type: ReportDefinitionDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() tenant: Tenant) {
    return this.service.get(tenant.id, id);
  }

  @Patch('definitions/:id')
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOkResponse({ type: ReportDefinitionDetailDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportDefinitionDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateDraft(viewer(tenant, user), id, dto);
  }

  @Post('definitions/:id/publish')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOperation({ summary: 'Freeze the draft as the next version, the one people run.' })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    const version = await this.service.publish(viewer(tenant, user), id);
    return { id: version.id, definition_id: version.definition_id, version: version.version };
  }

  @Post('definitions/:id/clone')
  @UseInterceptors(IdempotencyInterceptor)
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOperation({ summary: 'A new draft from this report (yours or a ready one).' })
  @ApiOkResponse({ type: ReportDefinitionDetailDto })
  clone(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.clone(viewer(tenant, user), id);
  }

  @Post('definitions/:id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOkResponse({ type: ReportDefinitionDetailDto })
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.archive(viewer(tenant, user), id);
  }
}
