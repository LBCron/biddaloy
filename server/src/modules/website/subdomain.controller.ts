import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  BadRequestException,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { SubdomainService } from './subdomain.service';
import { PreviewTokenService } from './preview-token.service';
import { SiteConfigService } from './site-config.service';
import { SiteDto } from './dto/site-config.dto';
import {
  PreviewTokenDto,
  SetSubdomainDto,
  SubdomainCheckDto,
  SubdomainSuggestDto,
} from './dto/subdomain.dto';

type Tenant = { id: string };

/** [40.2.01] The site's web address and its draft preview link. WEBSITE_MANAGE on every route. */
@ApiTags('website')
@ApiTenantAuth()
@Controller('website')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.WEBSITE_MANAGE)
export class SubdomainController {
  constructor(
    private readonly subdomains: SubdomainService,
    private readonly tokens: PreviewTokenService,
    private readonly config: SiteConfigService,
  ) {}

  @Get('subdomain/check')
  @ApiOperation({
    summary: 'Is this address free? `available: false` for invalid and taken alike.',
  })
  @ApiOkResponse({ type: SubdomainCheckDto })
  check(@Query('value') value: unknown, @CurrentTenant() t: Tenant) {
    return this.subdomains.check(t.id, value);
  }

  @Get('subdomain/suggest')
  @ApiOperation({ summary: 'Free addresses built from the school name.' })
  @ApiOkResponse({ type: SubdomainSuggestDto })
  suggest(@CurrentTenant() t: Tenant) {
    return this.subdomains.suggest(t.id);
  }

  @Put('subdomain')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Rename the site address. Needs an `Idempotency-Key` (Rule 25). The old name redirects for 30 days. 400 site.subdomain_unavailable.',
  })
  @ApiOkResponse({ type: SiteDto })
  rename(
    @Body() dto: SetSubdomainDto,
    @CurrentTenant() t: Tenant,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    // The interceptor lets a request with no key through, so the requirement lives here.
    if (key === undefined) {
      throw new BadRequestException('Idempotency-Key header is required to rename the site.');
    }
    return this.subdomains.rename(t.id, dto.value);
  }

  @Get('preview-token')
  @ApiOperation({ summary: 'A 1-hour link to the draft site, for the admin only.' })
  @ApiOkResponse({ type: PreviewTokenDto })
  async previewToken(@CurrentTenant() t: Tenant) {
    const root = process.env.SITE_ROOT_DOMAIN?.trim().toLowerCase();
    if (!root) throw new ConflictException('site.unavailable');
    const { subdomain } = await this.config.get(t.id);
    return { url: `https://${subdomain}.${root}/?preview=${this.tokens.sign(t.id)}` };
  }
}
