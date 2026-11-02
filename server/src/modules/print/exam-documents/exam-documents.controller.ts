import { Controller, Get, ParseUUIDPipe, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { ExamDocumentsService } from './exam-documents.service';
import {
  AdmitCardRosterDto,
  MeritCandidateDto,
  MeritCandidatesQueryDto,
  TabulationDto,
  FinalTabulationDto,
  TabulationQueryDto,
} from './dto/exam-documents.dto';

/** [48.2.05] Feeds for the exam "Print" tab. */
@ApiTags('exam-documents')
@ApiTenantAuth()
@Controller('exams/:examId/documents')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ExamDocumentsController {
  constructor(private readonly service: ExamDocumentsService) {}

  @Get('admit-cards')
  @RequirePermissions(Permission.DOCUMENT_PRINT)
  @ApiOperation({ summary: 'Admit-card roster: copies printed and (if withheld) who owes.' })
  @ApiOkResponse({ type: AdmitCardRosterDto })
  admitCards(
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentTenant() tenant: { id: string },
  ): Promise<AdmitCardRosterDto> {
    return this.service.admitCardRoster(tenant.id, examId);
  }

  @Get('merit-candidates')
  @RequirePermissions(Permission.DOCUMENT_PRINT)
  @ApiOperation({ summary: 'Top N published results of the class or of each section.' })
  @ApiOkResponse({ type: [MeritCandidateDto] })
  meritCandidates(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: MeritCandidatesQueryDto,
    @CurrentTenant() tenant: { id: string },
  ): Promise<MeritCandidateDto[]> {
    return this.service.meritCandidates(tenant.id, examId, query);
  }

  @Get('tabulation')
  @RequirePermissions(Permission.DOCUMENT_PRINT)
  @ApiOperation({ summary: 'Per-subject marks of every student in one section.' })
  @ApiOkResponse({ type: TabulationDto })
  tabulation(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Query() query: TabulationQueryDto,
    @CurrentTenant() tenant: { id: string },
  ): Promise<TabulationDto> {
    return this.service.tabulation(tenant.id, examId, query.section_id);
  }
}

/** [70.4.1, D20] Final-result tabulation feed for the final's "Print" tab. */
@ApiTags('exam-documents')
@ApiTenantAuth()
@Controller('final-results/:finalResultId/documents')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class FinalDocumentsController {
  constructor(private readonly service: ExamDocumentsService) {}

  @Get('tabulation')
  @RequirePermissions(Permission.DOCUMENT_PRINT)
  @ApiOperation({ summary: 'Final result: per-subject exam and final marks of one section.' })
  @ApiOkResponse({ type: FinalTabulationDto })
  tabulation(
    @Param('finalResultId', ParseUUIDPipe) finalResultId: string,
    @Query() query: TabulationQueryDto,
    @CurrentTenant() tenant: { id: string },
  ): Promise<FinalTabulationDto> {
    return this.service.finalTabulation(tenant.id, finalResultId, query.section_id);
  }
}
