import {
  Body,
  Controller,
  Delete,
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
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { AudienceQueryDto } from '../audience/dto/audience-query.dto';
import { NoticesService } from './notices.service';
import { NoticeActor, NoticeRecipientsService } from './notice-recipients.service';
import {
  AddRecipientsDto,
  AddRecipientsResultDto,
  CreateNoticeDto,
  NoticeDto,
  NoticeListQueryDto,
  NoticePageDto,
  NoticeRecipientPageDto,
  NoticeReportDto,
  NoticeReportQueryDto,
  PublicLinkDto,
  PublishNoticeDto,
  RecipientPageQueryDto,
  RemoveRecipientsDto,
  UpdateNoticeDto,
} from './dto/notice.dto';

type Tenant = { id: string; role: string };
const actorOf = (t: Tenant, u: JwtPayload): NoticeActor => ({ userId: u.sub, role: t.role });

/**
 * [53.2.04] Notice authoring. NOTICE_POST on every route; an author manages their own notices and
 * NOTICE_MANAGE holders manage any (someone else's notice is a 404, D20). No route sends SMS (D24).
 */
@ApiTags('notices')
@ApiTenantAuth()
@Controller('notices')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.NOTICE_POST)
export class NoticesController {
  constructor(
    private readonly notices: NoticesService,
    private readonly recipients: NoticeRecipientsService,
  ) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create a draft notice' })
  @ApiCreatedResponse({ type: NoticeDto })
  create(@Body() dto: CreateNoticeDto, @CurrentTenant() t: Tenant, @CurrentUser() u: JwtPayload) {
    return this.notices.create(t.id, actorOf(t, u), dto);
  }

  @Get()
  @ApiOperation({ summary: 'My notices (all notices for NOTICE_MANAGE)' })
  @ApiOkResponse({ type: NoticePageDto })
  list(@Query() q: NoticeListQueryDto, @CurrentTenant() t: Tenant, @CurrentUser() u: JwtPayload) {
    return this.notices.list(t.id, actorOf(t, u), q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One notice with its counts' })
  @ApiOkResponse({ type: NoticeDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.get(t.id, actorOf(t, u), id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a draft or a published notice (published: stamps edited_at, no push)',
  })
  @ApiOkResponse({ type: NoticeDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoticeDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.update(t.id, actorOf(t, u), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a DRAFT notice (a published one answers 409: withdraw it)' })
  @ApiNoContentResponse()
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.remove(t.id, actorOf(t, u), id);
  }

  @Post(':id/copy')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'New draft with the same text, flags and Chosen list (no files)' })
  @ApiCreatedResponse({ type: NoticeDto })
  copy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.copy(t.id, actorOf(t, u), id);
  }

  @Get(':id/recipients')
  @ApiOperation({ summary: 'The Chosen list, paged' })
  @ApiOkResponse({ type: NoticeRecipientPageDto })
  listRecipients(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: RecipientPageQueryDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.listRecipients(t.id, actorOf(t, u), id, q.page, q.limit);
  }

  @Post(':id/recipients')
  @ApiOperation({ summary: 'Add people from audience results (DRAFT only)' })
  @ApiCreatedResponse({ type: AddRecipientsResultDto })
  addRecipients(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddRecipientsDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.recipients.add(t.id, actorOf(t, u), id, dto.items);
  }

  @Post(':id/recipients/matching')
  @ApiOperation({ summary: 'Add everyone an audience filter matches (max 5,000)' })
  @ApiCreatedResponse({ type: AddRecipientsResultDto })
  addMatching(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AudienceQueryDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.recipients.addMatching(t.id, actorOf(t, u), id, dto);
  }

  @Delete(':id/recipients')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove rows from the Chosen list (DRAFT only)' })
  @ApiNoContentResponse()
  removeRecipients(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveRecipientsDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.recipients.remove(t.id, actorOf(t, u), id, dto.ids);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Publish: snapshot the list, push, alert, link. Never sends SMS.' })
  @ApiOkResponse({ type: NoticeDto })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishNoticeDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.publish(t.id, actorOf(t, u), id, dto.requestSms ?? false);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw: links, alert and pending SMS request stop' })
  @ApiOkResponse({ type: NoticeDto })
  withdraw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.withdraw(t.id, actorOf(t, u), id);
  }

  @Post(':id/sms/request')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Ask an admin to approve an SMS copy. Sends nothing.' })
  @ApiOkResponse({ type: NoticeDto })
  requestSms(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.requestSms(t.id, actorOf(t, u), id);
  }

  // No IdempotencyInterceptor here: it would store the raw token in Redis for 24 h.
  @Post(':id/public-link')
  @ApiOperation({ summary: 'Make a new public link (the old one stops). Token shown once.' })
  @ApiCreatedResponse({ type: PublicLinkDto })
  newPublicLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.newPublicLink(t.id, actorOf(t, u), id);
  }

  @Delete(':id/public-link')
  @HttpCode(204)
  @ApiOperation({ summary: 'Turn the public link off' })
  @ApiNoContentResponse()
  turnOffPublicLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.turnOffPublicLink(t.id, actorOf(t, u), id);
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'Per-person delivery report with totals' })
  @ApiOkResponse({ type: NoticeReportDto })
  report(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: NoticeReportQueryDto,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.notices.report(t.id, actorOf(t, u), id, q);
  }
}
