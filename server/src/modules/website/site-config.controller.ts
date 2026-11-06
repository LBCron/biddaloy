import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
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
import { SiteConfigService } from './site-config.service';
import {
  PublishDto,
  SaveDraftDto,
  SetEnabledDto,
  SiteDto,
  ThemeSummaryDto,
} from './dto/site-config.dto';

type Tenant = { id: string };

/** [40.1.04] ADMIN editing of the school website. WEBSITE_MANAGE on every route. */
@ApiTags('website')
@ApiTenantAuth()
@Controller('website')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.WEBSITE_MANAGE)
export class SiteConfigController {
  constructor(private readonly config: SiteConfigService) {}

  @Get()
  @ApiOperation({ summary: 'The site: draft, state and address. First call creates it.' })
  @ApiOkResponse({ type: SiteDto })
  get(@CurrentTenant() t: Tenant) {
    return this.config.get(t.id);
  }

  // Declared before the `:`-less routes below so `/themes` is never read as anything else.
  @Get('themes')
  @ApiOperation({ summary: 'The theme manifests a school can pick from.' })
  @ApiOkResponse({ type: [ThemeSummaryDto] })
  themes() {
    return this.config.themes();
  }

  @Put('draft')
  @ApiOperation({ summary: 'Save the draft. 400 site.invalid, 409 site.stale.' })
  @ApiOkResponse({ type: SiteDto })
  saveDraft(@Body() dto: SaveDraftDto, @CurrentTenant() t: Tenant) {
    return this.config.saveDraft(t.id, dto);
  }

  @Post('publish')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Publish the draft. Needs an `Idempotency-Key` header (Rule 25). 409 site.stale if the version or the draft changed.',
  })
  @ApiOkResponse({ type: SiteDto })
  publish(
    @Body() dto: PublishDto,
    @CurrentTenant() t: Tenant,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    // The interceptor lets a request with no key through, so the requirement lives here.
    if (key === undefined) {
      throw new BadRequestException('Idempotency-Key header is required to publish the site.');
    }
    return this.config.publish(t.id, dto.version, dto.draft_revision);
  }

  @Post('enabled')
  @HttpCode(200)
  @ApiOperation({ summary: 'Switch the public site on or off. On needs a published version.' })
  @ApiOkResponse({ type: SiteDto })
  setEnabled(@Body() dto: SetEnabledDto, @CurrentTenant() t: Tenant) {
    return this.config.setEnabled(t.id, dto.enabled);
  }
}
