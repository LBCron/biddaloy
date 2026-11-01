import {
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
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { NoticeReaderService } from './notice-reader.service';
import {
  NoticeMineDetailDto,
  NoticeMineListDto,
  NoticeMineQueryDto,
} from './dto/notice-reader.dto';

@ApiTags('notices')
@ApiTenantAuth()
@Controller('notices/mine')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.NOTICE_READ)
export class NoticeReaderController {
  constructor(private readonly service: NoticeReaderService) {}

  @Get()
  @ApiOperation({ summary: 'Notices addressed to me (current or archive)' })
  @ApiOkResponse({ type: NoticeMineListDto })
  list(
    @Query() query: NoticeMineQueryDto,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ): Promise<NoticeMineListDto> {
    return this.service.list(tenant.id, user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Open one of my notices; marks it seen' })
  @ApiOkResponse({ type: NoticeMineDetailDto })
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ): Promise<NoticeMineDetailDto> {
    return this.service.open(tenant.id, user.sub, id);
  }

  @Post(':id/acknowledge')
  @HttpCode(204)
  @ApiOperation({ summary: 'Acknowledge an important notice (পড়েছি)' })
  @ApiNoContentResponse()
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: { sub: string },
  ): Promise<void> {
    return this.service.acknowledge(tenant.id, user.sub, id);
  }
}
