import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtPayload, Permission, isGuardianRole } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { FamilyAccessService } from '../../students/family-access.service';
import { StatementQueryDto, StudentStatementDto } from './dto/student-statement.dto';
import { StudentStatementService } from './student-statement.service';

type Tenant = { id: string; role: string };

/**
 * [8.15.35] A student's statement: for staff who may read both invoices and payments, and for the
 * student's own guardian in the portal. A guardian asking about anyone else's child gets the same
 * 404 as for a student that does not exist.
 */
@ApiTags('fees')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class StudentStatementController {
  constructor(
    private readonly statements: StudentStatementService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  @Get('students/:studentId/statement')
  @RequirePermissions(Permission.INVOICE_READ, Permission.PAYMENT_READ)
  @ApiOperation({
    summary: "One student's bills, payments and discounts, with what is still owed after each.",
  })
  @ApiOkResponse({ type: StudentStatementDto })
  staff(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: StatementQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.statements.getStatement(tenant.id, user.sub, studentId, query);
  }

  @Get('portal/students/:studentId/statement')
  @RequirePermissions(Permission.FEE_READ)
  @ApiOperation({ summary: "A guardian's view of their own child's statement." })
  @ApiOkResponse({ type: StudentStatementDto })
  async portal(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: StatementQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!isGuardianRole(tenant.role)) throw new ForbiddenException();
    const linked = await this.familyAccess.getLinkedStudentIds(tenant.role, user.sub, tenant.id);
    if (!linked.includes(studentId)) throw new NotFoundException('Student not found');
    return this.statements.getStatement(tenant.id, user.sub, studentId, query);
  }
}
