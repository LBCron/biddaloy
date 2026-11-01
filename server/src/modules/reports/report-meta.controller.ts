import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  JwtPayload,
  Permission,
  REPORT_DEFINITION_SCHEMA_VERSION,
  UserRole,
} from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ReportMetaDto } from './dto/report-engine.dto';
import { ReportRegistry } from './engine/registry/registry';
import { RoleScopePolicy } from './engine/security/role-scope.policy';

/**
 * [8.15.24] What the designer may build from (Epic 8.15 D19): subject areas, fields and measures with
 * their labels, types and sensitivity. Never `sql`, `on`, a table or an alias: those stay on the server.
 * A field the caller's role may not see is left out (D5).
 */
@ApiTags('reports')
@ApiTenantAuth()
@Controller('reports')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportMetaController {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly policy: RoleScopePolicy,
  ) {}

  @Get('meta')
  @RequirePermissions(Permission.REPORTS_DESIGN)
  @ApiOperation({ summary: 'Subject areas, fields and measures a report can use. No SQL.' })
  @ApiOkResponse({ type: ReportMetaDto })
  meta(
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): ReportMetaDto {
    const ctx = { tenantId: tenant.id, userId: user.sub, role: tenant.role as UserRole };
    return {
      schema_version: REPORT_DEFINITION_SCHEMA_VERSION,
      areas: this.registry.areas().map((area) => ({
        key: area.key,
        fields: area.fields
          .filter((f) => this.policy.fieldAllowed(ctx, f))
          .map((f) => ({
            key: f.key,
            label_en: f.labelEn,
            label_bn: f.labelBn,
            type: f.type,
            sensitivity: f.sensitivity,
            filterable: f.filterable,
            groupable: f.groupable,
            sortable: f.sortable,
            ...(f.enumValues ? { enum_values: [...f.enumValues] } : {}),
          })),
        measures: area.measures
          .filter((m) => this.policy.fieldAllowed(ctx, m))
          .map((m) => ({
            key: m.key,
            label_en: m.labelEn,
            label_bn: m.labelBn,
            fn: m.fn,
            type: m.type,
            sensitivity: m.sensitivity,
          })),
      })),
    };
  }
}
