import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { Permission, JwtPayload, isGuardianRole } from '@biddaloy/shared';
import { FamilyAccessService } from '../students/family-access.service';
import { TranscriptService } from './transcript.service';
import { DocumentPrintDto, TranscriptQueryDto } from './dto/transcript.dto';

/**
 * [48.2.10] Same gating as `StudentResultsController`: `RESULT_READ` plus
 * `assertLinked` first, so a PARENT/STUDENT only reaches their own child and
 * only ever sees published exams.
 */
@ApiTags('results')
@ApiTenantAuth()
@Controller('students/:studentId')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class TranscriptController {
  constructor(
    private readonly transcriptService: TranscriptService,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  /** PARENT/STUDENT: linked only. TEACHER: own sections only (AUTH-06), same
   * rule as `GET /students/:id/results`, which returns the same history. */
  private async assertCanRead(
    studentId: string,
    tenant: { id: string; role: string },
    user: JwtPayload,
  ): Promise<void> {
    await this.familyAccess.assertLinked(tenant.role, user.sub, studentId, tenant.id);
  }

  @Get('transcript')
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary:
      "A student's yearly transcript: every published exam of the year, report-card data each.",
  })
  async getTranscript(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: TranscriptQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertCanRead(studentId, tenant, user);
    return this.transcriptService.getTranscript(
      tenant.id,
      studentId,
      query.academic_year_id,
      isGuardianRole(tenant.role),
    );
  }

  @Get('final-result-card')
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({
    summary:
      "A student's final report card for a year. Staff see a PROCESSED final too; PARENT/STUDENT (linked only) see PUBLISHED only.",
  })
  async getFinalResultCard(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: TranscriptQueryDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertCanRead(studentId, tenant, user);
    return this.transcriptService.getFinalResultCard(
      tenant.id,
      studentId,
      query.academic_year_id,
      isGuardianRole(tenant.role),
    );
  }

  @Post('document-prints')
  @HttpCode(204)
  @RequirePermissions(Permission.RESULT_READ)
  @ApiOperation({ summary: 'Audit-log one report-card or transcript print.' })
  async logDocumentPrint(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: DocumentPrintDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.assertCanRead(studentId, tenant, user);
    await this.transcriptService.logDocumentPrint(
      tenant.id,
      user.sub,
      studentId,
      dto,
      isGuardianRole(tenant.role),
    );
  }
}
