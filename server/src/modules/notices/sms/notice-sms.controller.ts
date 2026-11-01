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
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { FailClosedWithoutRedis } from '../../../common/rate-limit/app-throttler.guard';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import {
  NoticeSmsQueryDto,
  NoticeSmsViewDto,
  SmsDecisionDto,
  SmsRecipientsDto,
  SmsRecipientsResultDto,
} from './dto/notice-sms.dto';
import { NoticeSmsService } from './notice-sms.service';

type Tenant = { id: string; role: string };

/**
 * [53.5.01] SMS approval for a notice (D24, D25). NOTICE_SMS_APPROVE on every route; the requester
 * only sees the request on the notice itself. Nothing here runs without a deliberate call.
 */
@ApiTags('notice-sms')
@ApiTenantAuth()
@Controller('notices/:id/sms')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.NOTICE_SMS_APPROVE)
export class NoticeSmsController {
  constructor(private readonly sms: NoticeSmsService) {}

  @Get()
  @ApiOperation({ summary: 'The SMS request: people, counts, text and credit cost' })
  @ApiOkResponse({ type: NoticeSmsViewDto })
  view(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: NoticeSmsQueryDto,
    @CurrentTenant() t: Tenant,
  ) {
    return this.sms.view(t.id, id, q.page, q.limit);
  }

  @Patch('recipients')
  @ApiOperation({ summary: 'Tick or untick people while the request is pending' })
  @ApiOkResponse({ type: SmsRecipientsResultDto })
  setRecipients(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SmsRecipientsDto,
    @CurrentTenant() t: Tenant,
  ) {
    return this.sms.setWanted(t.id, id, dto.ids, dto.smsWanted);
  }

  @Post('approve')
  @HttpCode(200)
  @FailClosedWithoutRedis()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Approve: reserve credit, make personal links, queue one SMS each' })
  @ApiOkResponse({ type: SmsDecisionDto })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.sms.approve(t.id, id, u.sub);
  }

  @Post('decline')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Decline: nothing is sent' })
  @ApiOkResponse({ type: SmsDecisionDto })
  decline(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() t: Tenant,
    @CurrentUser() u: JwtPayload,
  ) {
    return this.sms.decline(t.id, id, u.sub);
  }
}
