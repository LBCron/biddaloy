import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { SitePostsService } from './site-posts.service';
import { PostDto, PostListDto, PostListQueryDto, SavePostDto } from './dto/site-post.dto';

type Tenant = { id: string };

/** [40.3.01] Blog posts and pages. WEBSITE_MANAGE on every route. */
@ApiTags('website')
@ApiTenantAuth()
@Controller('website/posts')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.WEBSITE_MANAGE)
export class SitePostsController {
  constructor(private readonly posts: SitePostsService) {}

  @Get()
  @ApiOperation({ summary: 'The school’s posts, newest first. `limit` is at most 100.' })
  @ApiOkResponse({ type: PostListDto })
  list(@CurrentTenant() t: Tenant, @Query() q: PostListQueryDto) {
    return this.posts.list(t.id, q.page, q.limit);
  }

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      'Create a post (not yet shown). Send an `Idempotency-Key` (Rule 25). 400 site.post_invalid for a bad title, body or picture.',
  })
  @ApiOkResponse({ type: PostDto })
  create(@Body() dto: SavePostDto, @CurrentTenant() t: Tenant) {
    return this.posts.create(t.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One post, with its Slate body.' })
  @ApiOkResponse({ type: PostDto })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    return this.posts.get(t.id, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Replace title, cover and body. The address (slug) never changes.' })
  @ApiOkResponse({ type: PostDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SavePostDto,
    @CurrentTenant() t: Tenant,
  ) {
    return this.posts.update(t.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a post. 409 site.post_in_use while the site config points at it.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    await this.posts.remove(t.id, id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Show the post on the site. Send an `Idempotency-Key` (Rule 25).' })
  @ApiOkResponse({ type: PostDto })
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    return this.posts.publish(t.id, id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hide the post again; the content is kept.' })
  @ApiOkResponse({ type: PostDto })
  unpublish(@Param('id', ParseUUIDPipe) id: string, @CurrentTenant() t: Tenant) {
    return this.posts.unpublish(t.id, id);
  }
}
