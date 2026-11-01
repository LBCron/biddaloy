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
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../common/decorators/api-tenant-auth.decorator';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { requestContext } from '../../common/request-context.util';
import { CoordinatorsService } from './coordinators.service';
import {
  AssignCoordinatorsDto,
  CoordinatorAssignmentDto,
  ListCoordinatorsQueryDto,
} from './dto/coordinators.dto';

/**
 * [83.2.2] Admin assign / list / remove of class and subject coordinators (Epic 83 D20, D21).
 * `CLASS_MANAGE`, like the section teacher-assignment routes it sits next to.
 */
@ApiTags('coordinators')
@ApiTenantAuth()
@Controller('coordinators')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequirePermissions(Permission.CLASS_MANAGE)
export class CoordinatorsController {
  constructor(private readonly coordinators: CoordinatorsService) {}

  @Get()
  @ApiOperation({ summary: 'List coordinator assignments, by teacher and/or class.' })
  @ApiOkResponse({ type: CoordinatorAssignmentDto, isArray: true })
  list(
    @CurrentTenant() tenant: { id: string },
    @Query() query: ListCoordinatorsQueryDto,
  ): Promise<CoordinatorAssignmentDto[]> {
    return this.coordinators.list(tenant.id, query);
  }

  @Post()
  // Rule 25: a resent Save with the same Idempotency-Key creates the rows once.
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary: 'Make a teacher coordinator of one or more classes, optionally for one subject.',
  })
  @ApiCreatedResponse({ type: CoordinatorAssignmentDto, isArray: true })
  assign(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignCoordinatorsDto,
    @Req() request: Request,
  ): Promise<CoordinatorAssignmentDto[]> {
    return this.coordinators.assign(tenant.id, user.sub, dto, requestContext(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove one coordinator assignment.' })
  remove(
    @CurrentTenant() tenant: { id: string },
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.coordinators.remove(tenant.id, id, user.sub, requestContext(request));
  }
}
