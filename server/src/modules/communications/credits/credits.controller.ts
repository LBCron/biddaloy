import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunicationMedium, Permission } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { ApiTenantAuth } from '../../../common/decorators/api-tenant-auth.decorator';
import { SmsCreditService } from './sms-credit.service';
import {
  QuerySmsCreditsDto,
  SmsCreditsResponseDto,
  SmsReadinessResponseDto,
} from './dto/sms-credits.dto';
import { MessagingConfigResolver } from '../config/messaging-config.resolver';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';

/**
 * [15.6.7/#550] A tenant's own SMS credit balance + movement history.
 * Read-only — the only writer is `SmsCreditService`, reached here or via
 * the platform grant/adjust endpoint (`SchoolsSmsCreditsController`).
 * Deliberately no recipient/message data on any ledger row (see the DTO).
 */
@ApiTags('communications')
@ApiTenantAuth()
@Controller('communications/sms-credits')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
export class CreditsController {
  constructor(
    private readonly smsCredits: SmsCreditService,
    private readonly providerConfig: MessagingConfigResolver,
  ) {}

  /** [78 D37/D38] Can an SMS go out right now? Same resolver and credit check
   * the send path uses, so the answer cannot drift from it. Open to every
   * sender (not only credit readers) because it carries no balance. No
   * outbound HTTP: config resolution only. */
  @Get('readiness')
  @RequirePermissions(Permission.COMMUNICATION_SEND)
  @ApiOperation({
    summary:
      'Whether this school can send an SMS right now: READY, NO_GATEWAY (no SMS set-up) ' +
      'or NO_CREDIT (metered and out of credit). Never blocks a send; the UI only warns.',
  })
  @ApiOkResponse({ type: SmsReadinessResponseDto })
  async getSmsReadiness(
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<SmsReadinessResponseDto> {
    try {
      await this.providerConfig.resolve(CommunicationMedium.SMS, tenant.id);
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) return { sms: 'NO_GATEWAY' };
      throw error;
    }
    // ponytail: `available <= 0` is a yes/no on having any credit at all (D37);
    // a 1-credit school sending a 2-segment SMS is READY here and still gets
    // the send path's 409. Segment-aware readiness would need the draft text.
    if (
      (await this.smsCredits.isMetered(tenant.id)) &&
      (await this.smsCredits.getBalance(tenant.id)).available <= 0
    ) {
      return { sms: 'NO_CREDIT' };
    }
    return { sms: 'READY' };
  }

  @Get()
  @RequirePermissions(Permission.COMMUNICATION_CREDIT_READ)
  @ApiOperation({
    summary:
      "This tenant's SMS credit balance and ledger, newest first. `metering: 'OFF'` still " +
      'returns the shape (an always-0/0 balance, an empty ledger) rather than a different one.',
  })
  @ApiOkResponse({ type: SmsCreditsResponseDto })
  async getSmsCredits(
    @Query() query: QuerySmsCreditsDto,
    @CurrentTenant() tenant: { id: string; role: string },
  ): Promise<SmsCreditsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const summary = await this.smsCredits.getCreditsSummary(tenant.id, page, limit);

    return {
      ...summary,
      ledger: {
        ...summary.ledger,
        data: summary.ledger.data.map((row) => ({
          id: row.id,
          kind: row.kind,
          units: row.units,
          reference_type: row.reference_type,
          reference_id: row.reference_id,
          reason: row.reason,
          created_at: row.created_at,
        })),
      },
    };
  }
}
