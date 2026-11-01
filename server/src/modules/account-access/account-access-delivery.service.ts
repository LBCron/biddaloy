import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { sendOriginMetadata } from '../communications/providers/send-through-provider';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { isSecretEchoEnabled } from './account-access-echo';
import { Repository } from 'typeorm';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';
import { SchoolsService } from '../schools/schools.service';
import { DEFAULT_REGION_SETTINGS } from '../schools/settings/tenant-settings-defaults';
import {
  PLATFORM_SENDER_NAME,
  render,
  redact,
  resolveTemplateLocale,
  TemplateKind,
  TemplateVars,
} from './account-access-templates';
import { User } from '../users/entities/user.entity';

export type DeliveryMedium = typeof CommunicationMedium.SMS | typeof CommunicationMedium.EMAIL;

export interface DeliverInput {
  /** null = platform sender for a shared user (D28): "SchoolManager", platform gateway, no school comm log. */
  tenantId: string | null;
  medium: DeliveryMedium;
  to: string;
  recipientName: string;
  kind: TemplateKind;
  vars: Omit<TemplateVars, 'school' | 'name'>;
  /**
   * Extra, non-secret fields merged into `communication_logs.metadata`
   * alongside `kind` — e.g. `{ batch_id }` for a batch-dispatched
   * invitation (12.6), so `GuardianProvisioningService.batchStatus` can
   * count rows by `metadata->>'batch_id'` without a new `ReminderBatch`-like
   * entity.
   */
  metadata?: Record<string, unknown>;
}

export interface DeliverResult {
  logId: string | null;
  status: CommunicationStatus;
}

/**
 * Sends an account-access message (invitation, OTP, password-reset link,
 * email-verify link) and logs it — without ever letting the secret sit in
 * `communication_logs.message_body` (12.1's D4). The real, secret-bearing
 * body is a local variable only: it goes to the provider and nowhere else.
 */
@Injectable()
export class AccountAccessDeliveryService {
  private readonly logger = new Logger(AccountAccessDeliveryService.name);

  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    private readonly registry: CommunicationProviderRegistryService,
    private readonly schoolsService: SchoolsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Runs `work` after the response is sent, so a caller's timing cannot depend on
   * it (enumeration-safe routes). The callers put everything after their one
   * user lookup in `work`, so a known and an unknown identifier do the same
   * single query before responding. A failure is logged, never thrown.
   *
   * Echo mode (`ACCOUNT_ACCESS_ECHO_SECRETS`, which `assertSecretEchoAllowed`
   * refuses to boot with in production) awaits instead and returns the job's
   * value, so the `debug` echo and specs that read the DB right after the call
   * keep working. `NODE_ENV=test` alone does not await.
   *
   * ponytail: the known branch's job still runs on the same event loop and DB
   * pool right after the response, so it can slow the *next* request by a hair.
   * Nothing tracks in-flight jobs, so a deploy (SIGTERM) can drop one after the
   * token/OTP and audit row are written but before the send: the user got a
   * 202, gets no code, and the cooldown swallows an immediate retry. The window
   * is milliseconds per request. A queue on a separate worker if either ever
   * matters.
   */
  async detach<T>(flow: string, work: () => Promise<T>): Promise<T | undefined> {
    // async + try/catch: a synchronous throw inside `work` is caught too, never
    // escaping setImmediate as an uncaughtException.
    const run = async (): Promise<T | undefined> => {
      try {
        return await work();
      } catch (e) {
        const msg = `Detached ${flow} job failed: ${e instanceof Error ? e.message : String(e)}`;
        // A resend losing the race with a concurrent activation is expected, not an error.
        if (e instanceof ConflictException) this.logger.warn(msg);
        else this.logger.error(msg, e instanceof Error ? e.stack : undefined);
        return undefined;
      }
    };
    if (isSecretEchoEnabled(this.config)) return run();
    setImmediate(() => void run());
    return undefined;
  }

  async deliver(input: DeliverInput): Promise<DeliverResult> {
    if (input.tenantId === null) return this.deliverAsPlatform(input);
    const settings = await this.schoolsService.getResolvedSettings(input.tenantId);
    const locale = resolveTemplateLocale(settings.region?.locale);
    const school = await this.schoolsService.findById(input.tenantId);

    const vars: TemplateVars = { school: school.name, name: input.recipientName, ...input.vars };
    const real = render(input.kind, input.medium, locale, vars);
    const redacted = redact(input.kind, input.medium, locale, vars);

    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: input.tenantId,
        medium: input.medium,
        recipient_address: input.to,
        recipient_name: input.recipientName,
        message_body: redacted.body,
        subject: redacted.subject ?? null,
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.ACCOUNT_ACCESS,
        metadata: { ...input.metadata, kind: input.kind },
      }),
    );

    const provider = this.registry.resolve(input.medium);
    if (!provider) {
      log.status = CommunicationStatus.FAILED;
      log.metadata = {
        kind: input.kind,
        ...input.metadata,
        error: `No provider configured for ${input.medium}`,
      };
      await this.logRepo.save(log);
      return { logId: log.id, status: CommunicationStatus.FAILED };
    }

    try {
      const result = await provider.send(
        { to: input.to, body: real.body, subject: real.subject, allowPlatformSms: true },
        input.tenantId,
      );
      if (result.success) {
        log.status = CommunicationStatus.SENT;
        log.provider_message_id = result.providerMessageId;
        log.metadata = withOrigin(log.metadata, result);
        await this.logRepo.save(log);
        return { logId: log.id, status: CommunicationStatus.SENT };
      }
      // Never persist `result.error`/`error.message` verbatim — a provider
      // or gateway can echo the request body (including this message's
      // secret-bearing `real.body`, e.g. an activation link or OTP) back in
      // its error text, which would land in communication_logs.metadata.
      log.status = CommunicationStatus.FAILED;
      log.metadata = withOrigin(
        { ...input.metadata, kind: input.kind, error: 'Delivery failed' },
        result,
      );
      await this.logRepo.save(log);
      return { logId: log.id, status: CommunicationStatus.FAILED };
    } catch {
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...input.metadata, kind: input.kind, error: 'Delivery failed' };
      await this.logRepo.save(log);
      return { logId: log.id, status: CommunicationStatus.FAILED };
    }
  }

  // communication_logs is per school (tenant_id NOT NULL), so a platform
  // send leaves no row there — one Logger line, never the body/code/link.
  private async deliverAsPlatform(input: DeliverInput): Promise<DeliverResult> {
    const locale = resolveTemplateLocale(DEFAULT_REGION_SETTINGS.locale);
    const vars: TemplateVars = {
      school: PLATFORM_SENDER_NAME,
      name: input.recipientName,
      ...input.vars,
    };
    const real = render(input.kind, input.medium, locale, vars);
    const provider = this.registry.resolve(input.medium);
    let status: CommunicationStatus = CommunicationStatus.FAILED;
    if (provider) {
      try {
        const result = await provider.send(
          { to: input.to, body: real.body, subject: real.subject, allowPlatformSms: true },
          null,
        );
        if (result.success) status = CommunicationStatus.SENT;
      } catch {
        // status stays FAILED
      }
    }
    this.logger.log(`platform ${input.kind} via ${input.medium}: ${status}`);
    return { logId: null, status };
  }
}

// Only the vendor's name and account (never a secret) so Check status can find it (#3344).
const withOrigin = (
  meta: Record<string, unknown> | null,
  result: Parameters<typeof sendOriginMetadata>[0],
) => {
  const origin = sendOriginMetadata(result);
  return Object.keys(origin).length ? { ...meta, ...origin } : meta;
};

/** `EMAIL` if the user has one, else `SMS` if they have a phone, else `null` — the caller's job to decide, per D5/the plan. */
export function pickChannel(
  user: Pick<User, 'email' | 'phone'>,
): { medium: DeliveryMedium; to: string } | null {
  if (user.email) return { medium: CommunicationMedium.EMAIL, to: user.email };
  if (user.phone) return { medium: CommunicationMedium.SMS, to: user.phone };
  return null;
}
