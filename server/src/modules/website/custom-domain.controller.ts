import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { SETTINGS_RATE_LIMIT } from '../../rate-limit';
import { CustomDomainService } from './custom-domain.service';
import { UmamiService } from './umami.service';
import { AnalyticsDto, CustomDomainStatusDto, SetCustomDomainDto } from './dto/custom-domain.dto';

type Tenant = { id: string };

/** [40.4.08] The school's own domain and its 30-day visitor card. WEBSITE_MANAGE on every route. */
@ApiTags('website')
@ApiTenantAuth()
@Controller('website')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.WEBSITE_MANAGE)
export class CustomDomainController {
  constructor(
    private readonly domains: CustomDomainService,
    private readonly umami: UmamiService,
  ) {}

  @Get('custom-domain')
  @ApiOperation({
    summary: 'Status and the DNS records to add. 409 site.custom_domain_unavailable when off.',
  })
  @ApiOkResponse({ type: CustomDomainStatusDto })
  get(@CurrentTenant() t: Tenant) {
    return this.domains.status(t.id);
  }

  @Put('custom-domain')
  @HttpCode(202)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Attach a domain. Needs an `Idempotency-Key` (Rule 25). 409 site.custom_domain_unavailable for every refusal; 503 site.custom_domain_try_later when Cloudflare is down.',
  })
  @ApiOkResponse({ type: CustomDomainStatusDto })
  set(
    @Body() dto: SetCustomDomainDto,
    @CurrentTenant() t: Tenant,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    // The interceptor lets a request with no key through, so the requirement lives here.
    if (key === undefined) {
      throw new BadRequestException('Idempotency-Key header is required to set a custom domain.');
    }
    return this.domains.set(t.id, dto.host);
  }

  @Delete('custom-domain')
  @HttpCode(204)
  @ApiOperation({ summary: 'Detach the domain; the subdomain keeps answering.' })
  async remove(@CurrentTenant() t: Tenant) {
    await this.domains.remove(t.id);
  }

  @Post('custom-domain/recheck')
  @HttpCode(200)
  @Throttle({ default: SETTINGS_RATE_LIMIT })
  @ApiOperation({ summary: 'Ask Cloudflare once now.' })
  @ApiOkResponse({ type: CustomDomainStatusDto })
  recheck(@CurrentTenant() t: Tenant) {
    return this.domains.recheck(t.id);
  }

  @Get('analytics')
  @ApiOperation({
    summary:
      'Pageviews and visitors, last 30 days. `{ available: false }` when Umami is off or down.',
  })
  @ApiOkResponse({ type: AnalyticsDto })
  analytics(@CurrentTenant() t: Tenant) {
    return this.umami.monthlyStats(t.id);
  }
}
