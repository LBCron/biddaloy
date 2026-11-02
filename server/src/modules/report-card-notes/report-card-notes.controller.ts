import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { requestContext } from '../../common/request-context.util';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  NotesOptionalSectionQueryDto,
  NotesSectionQueryDto,
  NotesTargetQueryDto,
  SaveReportCardNotesBodyDto,
} from './dto/report-card-notes.dto';
import { ReportCardNotesService } from './report-card-notes.service';

type Tenant = { id: string };

/**
 * [70.3.1] The guard needs ALL listed permissions (Epic 48 D40), so the two audiences get two
 * path families, one service: `my-class/sections/:sectionId/...` (MY_CLASS_VIEW; class teacher /
 * assistant of that section, else 404 — Rule 2) and `exams/:examId/...` /
 * `final-results/:id/...` (RESULT_PROCESS; office, any section).
 */
@ApiTags('report-card-notes')
@ApiTenantAuth()
@Controller()
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ReportCardNotesController {
  constructor(private readonly service: ReportCardNotesService) {}

  // ---- class teacher / assistant (target in the query) -----------------------------------

  @Get('my-class/sections/:sectionId/report-card-notes')
  @RequirePermissions(Permission.MY_CLASS_VIEW)
  @ApiOperation({ summary: "A section's remarks and conduct grades for one exam or final result." })
  async myGet(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Query() target: NotesTargetQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.assertHomeroom(tenant.id, user.sub, sectionId);
    return this.service.get(tenant.id, target, sectionId);
  }

  @Get('my-class/sections/:sectionId/report-card-notes/missing')
  @RequirePermissions(Permission.MY_CLASS_VIEW)
  @ApiOperation({ summary: 'How many students still lack a remark or full conduct grades.' })
  async myMissing(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Query() target: NotesTargetQueryDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.service.assertHomeroom(tenant.id, user.sub, sectionId);
    return this.service.missingCounts(tenant.id, target, sectionId);
  }

  @Put('my-class/sections/:sectionId/report-card-notes')
  @RequirePermissions(Permission.MY_CLASS_VIEW)
  @ApiOperation({ summary: "Save a section's remarks and conduct grades. 409 once published." })
  async mySave(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Query() target: NotesTargetQueryDto,
    @Body() dto: SaveReportCardNotesBodyDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    await this.service.assertHomeroom(tenant.id, user.sub, sectionId);
    return this.service.save(
      tenant.id,
      user.sub,
      target,
      sectionId,
      dto.notes,
      requestContext(request),
    );
  }

  // ---- office: exam ----------------------------------------------------------------------

  @Get('exams/:examId/report-card-notes')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: "A section's remarks and conduct grades for one exam." })
  getForExam(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: NotesSectionQueryDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.service.get(tenant.id, { exam_id: examId }, query.section_id);
  }

  @Get('exams/:examId/report-card-notes/missing')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({
    summary: 'Students lacking a remark or full conduct grades (no section = class).',
  })
  missingForExam(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: NotesOptionalSectionQueryDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.service.missingCounts(tenant.id, { exam_id: examId }, query.section_id);
  }

  @Put('exams/:examId/report-card-notes')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: "Save a section's remarks and conduct grades for an exam." })
  saveForExam(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: NotesSectionQueryDto,
    @Body() dto: SaveReportCardNotesBodyDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.save(
      tenant.id,
      user.sub,
      { exam_id: examId },
      query.section_id,
      dto.notes,
      requestContext(request),
    );
  }

  // ---- office: final result --------------------------------------------------------------

  @Get('final-results/:id/report-card-notes')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: "A section's remarks and conduct grades for a final result." })
  getForFinal(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: NotesSectionQueryDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.service.get(tenant.id, { final_result_id: id }, query.section_id);
  }

  @Get('final-results/:id/report-card-notes/missing')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({
    summary: 'Students lacking a remark or full conduct grades (no section = class).',
  })
  missingForFinal(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: NotesOptionalSectionQueryDto,
    @CurrentTenant() tenant: Tenant,
  ) {
    return this.service.missingCounts(tenant.id, { final_result_id: id }, query.section_id);
  }

  @Put('final-results/:id/report-card-notes')
  @RequirePermissions(Permission.RESULT_PROCESS)
  @ApiOperation({ summary: "Save a section's remarks and conduct grades for a final result." })
  saveForFinal(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: NotesSectionQueryDto,
    @Body() dto: SaveReportCardNotesBodyDto,
    @CurrentTenant() tenant: Tenant,
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    return this.service.save(
      tenant.id,
      user.sub,
      { final_result_id: id },
      query.section_id,
      dto.notes,
      requestContext(request),
    );
  }
}
