import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { CommunicationMedium, isValidPort, type ProviderDescriptor } from '@biddaloy/shared';
import {
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { MessagingProvider } from '../messaging-provider';
import { ConnectionTestResult } from '../shared/connection-test.types';
import {
  assertSafeSmtpDestination,
  DestinationBlockedError,
  OutboundDestinationError,
  SafeSmtpDestination,
} from '../shared/outbound-destination-guard';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';

/** `port` arrives as a string from the generic resolver (or a number from older callers). */
export interface ResolvedEmailConfig {
  host: string;
  port: string | number;
  user: string;
  password: string;
  from: string;
}

const DEFAULT_SMTP_PORT = 587;

/** Digits only, 1-65535 (blank = 587); anything else is a definite config error (never reaches the network). */
function parsePort(raw: string | number | undefined): number {
  const value = raw === undefined || raw === '' ? DEFAULT_SMTP_PORT : raw;
  if (!isValidPort(value)) {
    throw new ProviderNotConfiguredError(
      'Email',
      'SMTP port must be an integer between 1 and 65535.',
    );
  }
  return Number(value);
}

function mapSmtpError(err: unknown): string {
  if (err instanceof OutboundDestinationError) return err.publicMessage;
  if (err instanceof ProviderNotConfiguredError) return err.message;
  const code = (err as { code?: string } | null)?.code;
  if (code === 'EAUTH') {
    return 'Authentication rejected — check the SMTP username and password.';
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'EDNS') {
    return 'Could not reach the SMTP server — check the host and port.';
  }
  return 'Connection test failed — could not verify the credentials.';
}

const SEND_FAILED_ERROR =
  'Could not reach the SMTP server; the message may or may not have been sent.';

const SMTP_CONNECTION_ERROR_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNREFUSED',
]);

function isSmtpConnectionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return typeof code === 'string' && SMTP_CONNECTION_ERROR_CODES.has(code);
}

/**
 * Tries each of `destination.addresses` in order — pinning to a single
 * literal IP (instead of the original hostname) short-circuits
 * nodemailer's own DNS resolution, which otherwise gives it built-in
 * failover across multiple A/AAAA records; this restores that resilience
 * without a second DNS lookup. `buildTransport` gets a fresh transporter
 * per attempt (nodemailer transporters aren't safe to reuse across hosts).
 * Only a connection-class failure (that address wasn't reachable at all)
 * advances to the next one — an auth failure, a rejected message, or any
 * error nodemailer hasn't tagged as connection-level is assumed to mean
 * the address answered and something else went wrong, so it's surfaced
 * immediately rather than risking the message being sent twice.
 */
async function withPinnedAddressFallback<T>(
  destination: SafeSmtpDestination,
  buildTransport: (host: string) => nodemailer.Transporter,
  action: (transporter: nodemailer.Transporter) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const { address } of destination.addresses) {
    try {
      return await action(buildTransport(address));
    } catch (err) {
      lastError = err;
      if (!isSmtpConnectionError(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}

/**
 * Plain SMTP email — works against any SMTP endpoint (self-hosted,
 * SendGrid's SMTP relay, etc.), no vendor-specific SDK.
 *
 * The transporter is built fresh per send from that tenant's resolved
 * config rather than cached on the instance — a single cached transporter
 * would silently reuse the first tenant's SMTP credentials for every
 * tenant after it (#8.7.10).
 */
@Injectable()
export class SmtpProvider extends MessagingProvider<ResolvedEmailConfig> {
  readonly descriptor: ProviderDescriptor = {
    medium: CommunicationMedium.EMAIL,
    name: 'smtp',
    label: { en: 'SMTP email server', bn: 'এসএমটিপি ইমেইল সার্ভার' },
    capabilities: [],
    fields: [
      {
        key: 'host',
        label: { en: 'Email server (SMTP)', bn: 'ইমেইল সার্ভার (SMTP)' },
        kind: 'text',
        required: true,
        destination: true,
      },
      // Optional: parsePort defaults 587. Still destination-owned (see MessagingConfigResolver).
      {
        key: 'port',
        label: { en: 'Port', bn: 'পোর্ট' },
        kind: 'text',
        required: false,
        destination: true,
        format: 'port',
      },
      {
        key: 'user',
        label: { en: 'Server username', bn: 'সার্ভারের ব্যবহারকারীর নাম' },
        kind: 'text',
        required: true,
      },
      {
        key: 'password',
        label: { en: 'Server password', bn: 'সার্ভারের পাসওয়ার্ড' },
        kind: 'secret',
        required: true,
      },
      {
        key: 'from',
        label: { en: 'Send emails from', bn: 'যে ঠিকানা থেকে ইমেইল যাবে' },
        kind: 'text',
        required: true,
        // testConnection never reads it, so testing a new server does not need it.
        sendOnly: true,
      },
    ],
    supportsTestMessage: true,
  };
  readonly envPrefix = 'SMTP';

  async send(
    params: CommunicationSendParams,
    config: ResolvedEmailConfig,
  ): Promise<CommunicationSendResult> {
    try {
      const { host, user, password, from } = config;
      const port = parsePort(config.port);
      const destination = await assertSafeSmtpDestination(host, port);
      const info = await withPinnedAddressFallback(
        destination,
        (pinnedHost) =>
          nodemailer.createTransport({
            host: pinnedHost,
            port,
            secure: port === 465,
            auth: { user, pass: password },
            ...(destination.servername ? { tls: { servername: destination.servername } } : {}),
          }),
        (transporter) =>
          transporter.sendMail({
            from,
            to: params.to,
            subject: params.subject ?? '',
            text: params.body,
          }),
      );
      return {
        success: true,
        providerMessageId: info.messageId ?? null,
        raw: { response: info.response },
        outcome: 'ACCEPTED',
      };
    } catch (err) {
      // A resolved-to-a-blocked-destination or unconfigured-provider
      // failure is permanent — REJECTED, never reached the network. A DNS
      // hiccup, transport-level error, or anything else may have gone out
      // and gotten an ambiguous answer — AMBIGUOUS.
      const isDefinitelyRejected =
        err instanceof ProviderNotConfiguredError || err instanceof DestinationBlockedError;
      return {
        success: false,
        providerMessageId: null,
        // Rules 23/24: fixed text only. The guard's message carries the host, nodemailer's the
        // server's reply; the not-configured sentence is secret-free (deliveryErrorCode reads it).
        error:
          err instanceof OutboundDestinationError
            ? err.publicMessage
            : err instanceof ProviderNotConfiguredError
              ? err.message
              : SEND_FAILED_ERROR,
        retryable: isDefinitelyRejected ? false : undefined,
        outcome: isDefinitelyRejected ? 'REJECTED' : 'AMBIGUOUS',
      };
    }
  }

  /**
   * #8.7.12's connection test — `transporter.verify()` is nodemailer's own
   * cheapest check: it opens the connection and authenticates without
   * sending a message. `config` can be an unsaved draft or the tenant's
   * stored config; this method doesn't care which.
   */
  async testConnection(config: ResolvedEmailConfig): Promise<ConnectionTestResult> {
    try {
      const port = parsePort(config.port);
      const destination = await assertSafeSmtpDestination(config.host, port);
      await withPinnedAddressFallback(
        destination,
        (pinnedHost) =>
          nodemailer.createTransport({
            host: pinnedHost,
            port,
            secure: port === 465,
            auth: { user: config.user, pass: config.password },
            ...(destination.servername ? { tls: { servername: destination.servername } } : {}),
          }),
        (transporter) => transporter.verify(),
      );
      return { success: true, message: 'Connected — SMTP credentials verified.' };
    } catch (err) {
      return { success: false, message: mapSmtpError(err) };
    }
  }
}
