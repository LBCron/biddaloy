import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuditAction, CommunicationStatus, JwtPayload, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { PROVIDER_TEST_RATE_LIMIT } from '../../../rate-limit';
import { requestContext } from '../../../common/request-context.util';
import { assertCanManageSchool } from '../../schools/assert-can-manage-school.util';
import { AuditService } from '../../audit/audit.service';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { ConnectionTestService } from './connection-test.service';
import { TestConnectionDto } from '../dto/test-connection.dto';
import { ConnectionTestResultDto } from './connection-test-result.dto';

/**
 * `POST /schools/:id/settings/test` (#8.7.12) — lives in
 * `CommunicationsModule`, not `SchoolsModule`, purely because that's where
 * the 4 providers already are; the route path is still `/schools/...`,
 * same permission (`assertCanManageSchool`) and tenant-scope rules as
 * `SchoolsController`'s settings endpoints (#8.7.9). `SchoolsModule`
 * already can't import `CommunicationsModule` back (it would be
 * circular — `CommunicationsModule` imports `SchoolsModule` for
 * `MessagingConfigResolver`'s dependencies since #8.7.10), so the
 * controller has to live on this side.
 */
@ApiTags('schools')
@ApiTenantAuth()
@Controller('schools')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class ProviderConnectionTestController {
  private readonly logger = new Logger(ProviderConnectionTestController.name);

  constructor(
    private readonly connectionTest: ConnectionTestService,
    private readonly auditService: AuditService,
  ) {}

  @Post(':id/settings/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  // Tighter than settings GET/PATCH's STRICT_RATE_LIMIT — this is the one
  // endpoint that makes a real outbound call to a third party per request.
  @Throttle({ default: PROVIDER_TEST_RATE_LIMIT })
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    summary:
      "Test a communications provider's credentials (SMS/WhatsApp/Email/Messenger) using the provider's cheapest verification call. Sends no message unless `sendTo` is given (SMS/EMAIL only, needs an `Idempotency-Key` header): then one logged test message goes to that address. Pass `config` to test unsaved values before saving them; omitted fields fall back to what's already stored for this school.",
  })
  @ApiOkResponse({ type: ConnectionTestResultDto })
  @ApiForbiddenResponse({
    description:
      'An ADMIN attempted to manage a school other than their own; only a SUPER_ADMIN can manage any school.',
  })
  async testConnection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestConnectionDto,
    @CurrentTenant() tenant: { id: string; role: string },
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ) {
    assertCanManageSchool(tenant, id);
    // Rule 25: a real send needs a key. The interceptor validates its shape and replays repeats.
    if (dto.sendTo && request.headers['idempotency-key'] === undefined) {
      throw new BadRequestException('Idempotency-Key header is required to send a test message.');
    }
    // This handler decrypts a school's stored provider credentials and sends them to a third party,
    // and with `sendTo` it sends a real message. So the audit row is written on every outcome,
    // including a throw after the credentials were used or a message went out (PR #3325 review,
    // finding 2). Never the submitted config or the provider's result message, both of which can
    // carry secret-adjacent detail: only who tested what, and how it ended.
    let result: ConnectionTestResultDto | undefined;
    let outcome = 'error:500';
    try {
      result = await this.connectionTest.test(
        id,
        dto.medium,
        dto.config,
        dto.sendTo ? { sendTo: dto.sendTo, userId: user.sub } : undefined,
      );
      // The connection can pass while the gateway rejects the message: that is not a success.
      outcome =
        result.testMessage?.status === CommunicationStatus.FAILED
          ? 'send_failed'
          : result.success
            ? 'success'
            : 'failed';
      return result;
    } catch (err) {
      if (err instanceof HttpException) outcome = `error:${err.getStatus()}`;
      throw err;
    } finally {
      await this.auditService
        .record({
          action: AuditAction.SETTINGS_TEST,
          entity_type: 'School',
          entity_id: id,
          tenant_id: id,
          performed_by_user_id: user.sub,
          ip_address: requestContext(request).ip,
          user_agent: requestContext(request).userAgent,
          new_values: {
            medium: dto.medium,
            success: result?.success ?? false,
            outcome,
            ...(dto.sendTo ? { test_message: true } : {}),
            ...(result?.testMessage ? { test_message_log_id: result.testMessage.logId } : {}),
          },
        })
        // On a throw, keep the original 409/429/500 for the caller; the audit failure is logged.
        // After a real send, never turn it into a 500: the interceptor would free the key and the
        // same-key retry would send again (PR #3325 review round 3, finding 2).
        .catch((auditErr: unknown) => {
          if (result && !result.testMessage) throw auditErr;
          this.logger.error(
            `SETTINGS_TEST audit row not written: ${auditErr instanceof Error ? auditErr.name : 'error'}`,
          );
        });
    }
  }
}
