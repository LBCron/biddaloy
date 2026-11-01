import { CommunicationMedium } from '@biddaloy/shared';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { queueWorkers } from '../../../common/queue-workers';
import {
  MessagingConfigResolver,
  type ResolvedMessaging,
} from '../../communications/config/messaging-config.resolver';
import { descriptorsFor } from '../../schools/settings/messaging-descriptors';
import { ProviderNotConfiguredError } from '../../communications/config/provider-not-configured.error';
import { MailpitSinkProvider } from '../../communications/providers/sink/mailpit-sink.provider';
import { isMessageSink } from '../../communications/providers/sink/message-sink';
import { HealthService } from '../health.service';
import { TenantStatusService } from '../../schools/tenant-status.service';
import { PlatformAlertsDto } from './dto/platform-alerts.dto';

const PROBE_INTERVAL_MS = 30_000;
/** Consecutive failed probes (30 s apart) before the alert opens (D15). */
const FAILS_TO_OPEN = 3;

// `dataSource.query` returns `[rows, rowCount]` for UPDATE and plain rows for INSERT/SELECT.
type UpdateResult<T> = [T[], number];

const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const maskPhone = (p: string) => `***${p.slice(-3)}`;

/**
 * [75.34] Watches Redis from Postgres only (no BullMQ, no Redis): a 30 s timer probes Redis,
 * 3 failures in a row open one `REDIS_DOWN` row and text every platform SUPER_ADMIN, then hourly
 * while it stays open; the first good probe closes it and sends one "recovered" text.
 * Every state change is one conditional SQL statement, so several API instances never open two
 * rows or send twice. SMS goes straight to the registered provider with the platform's env config (D3), never the queue.
 */
@Injectable()
export class PlatformAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformAlertsService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private consecutiveFails = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly health: HealthService,
    private readonly config: ConfigService,
    private readonly resolver: MessagingConfigResolver,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  onModuleInit(): void {
    this.warnDeprecatedKeys();
    // Scripts (queueWorkers off) and tests never probe; tests call tick() directly.
    if (!queueWorkers.enabled || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), PROBE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async listOpen(): Promise<PlatformAlertsDto> {
    const rows: { kind: 'REDIS_DOWN'; opened_at: Date }[] = await this.dataSource.query(
      `SELECT kind, opened_at FROM platform_alerts WHERE cleared_at IS NULL ORDER BY opened_at`,
    );
    return { alerts: rows.map((r) => ({ kind: r.kind, opened_at: r.opened_at.toISOString() })) };
  }

  /** One probe cycle. Never throws; a tick still running makes the next one return at once. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const redis = await this.health.probeRedis();
      if (redis === 'ok') {
        this.consecutiveFails = 0;
        await this.closeStep();
      } else {
        this.consecutiveFails += 1;
        if (this.consecutiveFails >= FAILS_TO_OPEN) {
          await this.dataSource.query(
            `INSERT INTO platform_alerts (kind) VALUES ('REDIS_DOWN') ON CONFLICT (kind) WHERE cleared_at IS NULL DO NOTHING`,
          );
          await this.hourlyStep();
        }
      }
    } catch (error) {
      this.logger.error(
        `Platform alert tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Only the instance whose UPDATE returns the row sends (once per hour, D8). */
  private async hourlyStep(): Promise<void> {
    const [rows]: UpdateResult<{ opened_at: Date }> = await this.dataSource.query(
      `UPDATE platform_alerts SET last_sms_at = now(), sms_count = sms_count + 1, updated_at = now()
       WHERE kind = 'REDIS_DOWN' AND cleared_at IS NULL
         AND (last_sms_at IS NULL OR last_sms_at <= now() - interval '1 hour')
       RETURNING opened_at`,
    );
    if (rows.length === 0) return;
    await this.sendToOperators(
      `ALERT: Redis is down since ${hhmm(rows[0].opened_at)} UTC. Sign-in is closed. Repeats hourly until fixed.`,
    );
  }

  /**
   * The first good probe closes the alert; "recovered" goes out once, and only if "down" did.
   * ponytail: `consecutiveFails` is per instance and any instance's one good probe closes the
   * row, so a partial partition (one instance reaches Redis, another does not) repeats
   * ALERT → RECOVERED texts about every 2 min. Upgrade: close only after N good probes, or
   * gate a re-open text on the last close being over 1 h ago (12-operations.md §3.6).
   */
  private async closeStep(): Promise<void> {
    const [rows]: UpdateResult<{ opened_at: Date; cleared_at: Date; sms_count: number }> =
      await this.dataSource.query(
        `UPDATE platform_alerts SET cleared_at = now(), updated_at = now()
         WHERE kind = 'REDIS_DOWN' AND cleared_at IS NULL
         RETURNING opened_at, cleared_at, sms_count`,
      );
    if (rows.length === 0 || rows[0].sms_count === 0) return;
    const { opened_at, cleared_at } = rows[0];
    const minutes = Math.round((cleared_at.getTime() - opened_at.getTime()) / 60_000);
    await this.sendToOperators(
      `RECOVERED: Redis is back at ${hhmm(cleared_at)} UTC after ${minutes} min. Sign-in is open again.`,
    );
  }

  /**
   * Verified phones of the platform tenant's active SUPER_ADMINs; `PLATFORM_ALERT_PHONES` only
   * when there are none (D16). No platform tenant (production without `PLATFORM_TENANT_ID`) →
   * the env list only: never every school's SUPER_ADMINs.
   */
  async recipients(): Promise<string[]> {
    const platformTenant = await this.tenantStatus.platformTenantId();
    const rows: { phone: string }[] = platformTenant
      ? await this.dataSource.query(
          `SELECT DISTINCT u.phone FROM users u JOIN user_tenants ut ON ut.user_id = u.id
           WHERE ut.tenant_id = $1 AND ut.role = 'SUPER_ADMIN' AND ut.deleted_at IS NULL
             AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
             AND u.phone IS NOT NULL AND u.phone_verified_at IS NOT NULL`,
          [platformTenant],
        )
      : [];
    if (rows.length > 0) return rows.map((r) => r.phone);
    const fallback = (this.config.get<string>('PLATFORM_ALERT_PHONES') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    return [...new Set(fallback)];
  }

  private async sendToOperators(body: string): Promise<void> {
    const env = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
    const text = `[${env}] ${body}`;
    const phones = await this.recipients();
    if (isMessageSink()) {
      // Epic 87 (D23): staging/demo alerts land in the test inbox. The sink provider is used
      // directly, not through the config resolver or the queue: the alert path must work while
      // Redis is down. It never throws (returns a failed result), and the tick catches anyway.
      const sink = MailpitSinkProvider.forMedium(CommunicationMedium.SMS);
      // No recipients means no inbox message; say so, or the alert drops without a trace.
      if (phones.length === 0)
        this.logger.log('platform alert: no operator phones, nothing sent to the test inbox');
      for (const phone of phones) await sink.send({ to: phone, body: text });
      return;
    }
    // One warning per alert: resolveSms names the config problem and what was not sent.
    const resolved = await this.resolveSms(`; would text ${phones.length} phone(s): ${text}`);
    if (!resolved) return;
    const { provider, config } = resolved;
    for (const phone of phones) {
      try {
        const result = await provider.send({ to: phone, body: text }, config);
        // Status only: the provider's raw body can echo the full destination number.
        const { success, outcome, providerMessageId, error } = result;
        this.logger.log(
          `platform alert SMS to ${maskPhone(phone)}: ${JSON.stringify({ success, outcome, providerMessageId, error })}`,
        );
      } catch (error) {
        this.logger.error(
          `platform alert SMS to ${maskPhone(phone)} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** Deprecated `PLATFORM_SMS_*` keys: one boot warning, key names only (Rule 13). */
  private warnDeprecatedKeys(): void {
    const get = (k: string) => this.config.get<string>(k);
    // stack.yml defaults PLATFORM_SMS_PROVIDER, so it alone is never a signal.
    const names = ['PLATFORM_SMS_API_KEY', 'PLATFORM_SMS_SENDER_ID', 'PLATFORM_SMS_API_URL'];
    const setNames = names.filter((k) => get(k));
    if (setNames.length === 0) return;
    if (get('SMS_PROVIDER')) {
      this.logger.warn('PLATFORM_SMS_* ignored because SMS_PROVIDER is set');
      return;
    }
    if (get('PLATFORM_SMS_PROVIDER')) setNames.unshift('PLATFORM_SMS_PROVIDER');
    this.logger.warn(
      get('PLATFORM_SMS_API_KEY')
        ? `${setNames.join(', ')} are deprecated and read for one more release; set SMS_PROVIDER and the provider's own keys instead`
        : `${setNames.join(', ')} are set without PLATFORM_SMS_API_KEY, so they are ignored; set SMS_PROVIDER and the provider's own keys`,
    );
  }

  /**
   * Platform SMS config (D3): the registered provider and its env keys, never the queue.
   * For one release the old `PLATFORM_SMS_*` keys still work when `SMS_PROVIDER` is unset;
   * they ride in as the resolver override so `process.env` is never touched.
   * Returns undefined when nothing usable is configured; never throws (the tick must not).
   */
  private async resolveSms(notSent = ''): Promise<ResolvedMessaging | undefined> {
    const get = (k: string) => this.config.get<string>(k) || undefined;
    const legacyKey = get('PLATFORM_SMS_API_KEY');
    const legacy = !get('SMS_PROVIDER') && !!legacyKey;
    // Old meaning: the named provider if registered (any case), else the registry default.
    const wanted = get('PLATFORM_SMS_PROVIDER')?.trim().toLowerCase();
    const sms = descriptorsFor(CommunicationMedium.SMS);
    const provider = (sms.find((d) => d.name === wanted) ?? sms[0])?.name;
    // Nested under the provider: SMS has several providers, so the resolver ignores flat keys.
    const override =
      legacy && provider
        ? {
            provider,
            [provider]: {
              apiKey: legacyKey,
              senderId: get('PLATFORM_SMS_SENDER_ID'),
              apiUrl: get('PLATFORM_SMS_API_URL'),
            },
          }
        : undefined;
    try {
      return await this.resolver.resolve(CommunicationMedium.SMS, null, {
        allowPlatformKeys: true,
        override,
      });
    } catch (error) {
      // Only ProviderNotConfiguredError text is safe to log (names fields, never values).
      const reason =
        error instanceof ProviderNotConfiguredError
          ? legacy
            ? 'the deprecated PLATFORM_SMS_* keys are incomplete (PLATFORM_SMS_API_KEY, plus PLATFORM_SMS_SENDER_ID / PLATFORM_SMS_API_URL for some providers); set SMS_PROVIDER and the provider keys instead'
            : error.message
          : 'the config could not be resolved';
      this.logger.warn(`platform alert SMS not configured: ${reason}${notSent}`);
      return undefined;
    }
  }
}
