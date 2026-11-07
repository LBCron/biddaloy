import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { STRICT_RATE_LIMIT } from '../../rate-limit';
import { requestContext } from '../../common/request-context.util';
import { TurnstileService } from '../registration/turnstile.service';
import { TenantStatusService, tenantRestoringException } from '../schools/tenant-status.service';
import { PublicSiteService } from './public/public-site.service';
import { SiteEnquiriesService, officeSmsOn } from './site-enquiries.service';
import {
  CreateEnquiryDto,
  EnquiryDto,
  EnquiryListDto,
  EnquiryListQueryDto,
  EnquiryReceivedDto,
} from './dto/site-enquiry.dto';

type Tenant = { id: string };

/**
 * [40.3.01] The one public write of the site: no auth, no `X-Tenant-ID`; the host in the URL is the
 * only tenant signal. Order matters: the site must be live (unknown host, off site and suspended
 * school all answer the same 404), then Turnstile (fail-closed in production, Rule 22, D42), then
 * the write. `STRICT_RATE_LIMIT` (5/min) is per IP; the container forwards the visitor's IP.
 */
@ApiTags('public-site')
@Controller('public/site/by-host/:host/island/enquiry')
export class PublicEnquiryController {
  constructor(
    private readonly site: PublicSiteService,
    private readonly enquiries: SiteEnquiriesService,
    private readonly turnstile: TurnstileService,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: STRICT_RATE_LIMIT })
  @ApiOperation({
    summary:
      'Send an enquiry from the school site. 400 CAPTCHA_FAILED without a valid Turnstile token, 404 site.not_found, 429 over 5 a minute.',
  })
  @ApiCreatedResponse({ type: EnquiryReceivedDto })
  async create(
    @Param('host') host: string,
    @Body() dto: CreateEnquiryDto,
    @Req() request: Request,
  ): Promise<EnquiryReceivedDto> {
    const live = await this.site.liveForWrite(host);
    await this.turnstile.verify(dto.captcha_token, requestContext(request).ip);
    // No ContextGuard here, so the restore freeze is checked by hand (a restore would delete the row).
    if (await this.tenantStatus.isRestoring(live.tenantId)) throw tenantRestoringException();
    await this.enquiries.createPublic(live.tenantId, dto, {
      smsOn: officeSmsOn(live.published),
      phone: live.school.phone,
      schoolName: live.school.name,
    });
    return { received: true };
  }
}

/** [40.3.01] The জিজ্ঞাসা tab: read, tick seen, delete. WEBSITE_MANAGE on every route. */
@ApiTags('website')
@ApiTenantAuth()
@Controller('website/enquiries')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.WEBSITE_MANAGE)
export class SiteEnquiriesController {
  constructor(private readonly enquiries: SiteEnquiriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Enquiries, newest first, with the unseen count. `limit` is at most 100.',
  })
  @ApiOkResponse({ type: EnquiryListDto })
  list(@CurrentTenant() t: Tenant, @Query() q: EnquiryListQueryDto) {
    return this.enquiries.list(t.id, q.page, q.limit);
  }

  @Post(':id/seen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tick an enquiry as seen.' })
  @ApiOkResponse({ type: EnquiryDto })
  seen(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    return this.enquiries.markSeen(t.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an enquiry for good.' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    await this.enquiries.remove(t.id, id);
  }
}
