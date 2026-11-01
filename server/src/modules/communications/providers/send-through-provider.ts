import { Logger } from '@nestjs/common';
import { CommunicationMedium, countSmsSegments } from '@biddaloy/shared';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';
import type { MessagingProvider } from './messaging-provider';
import type {
  CommunicationSendParams,
  CommunicationSendResult,
} from './communication-provider.interface';

const logger = new Logger('MessagingSend');

// An SMS log always carries its segment count (#549/#570), even when the send failed early.
const segmentsFor = (medium: CommunicationMedium, params: CommunicationSendParams) =>
  medium === CommunicationMedium.SMS ? countSmsSegments(params.body).segments : undefined;

/**
 * A failure before any provider call (config resolution): it never reached the network, so always
 * REJECTED (the SMS credit is released). Only missing config is final; a settings-read blip retries.
 */
export function failedResult(
  err: unknown,
  medium: CommunicationMedium,
  params: CommunicationSendParams,
): CommunicationSendResult {
  if (!(err instanceof ProviderNotConfiguredError)) {
    // The error class only: its text may carry a URL or key (Rule 13).
    logger.warn(`Send failed with ${err instanceof Error ? err.name : typeof err}`);
  }
  return {
    success: false,
    providerMessageId: null,
    // Rule 24: only our own "not configured" sentence is stored; anything else (a DB or decrypt
    // error, a provider that threw) may carry raw driver text, so it gets a fixed sentence.
    error:
      err instanceof ProviderNotConfiguredError ? err.message : 'The message could not be sent.',
    segments: segmentsFor(medium, params),
    retryable: err instanceof ProviderNotConfiguredError ? false : undefined,
    outcome: 'REJECTED',
  };
}

/** Providers must not throw; if one does, whether it reached the network is unknown, so AMBIGUOUS. */
export async function sendThroughProvider<TConfig>(
  provider: MessagingProvider<TConfig>,
  params: CommunicationSendParams,
  config: TConfig,
  source?: CommunicationSendResult['source'],
): Promise<CommunicationSendResult> {
  const { medium, name } = provider.descriptor;
  const from = source ? { source } : {};
  try {
    const result = await provider.send(params, config);
    const segments = segmentsFor(medium, params);
    return {
      ...result,
      ...(segments !== undefined && result.segments === undefined ? { segments } : {}),
      provider: name,
      ...from,
    };
  } catch (err) {
    // Unknown whether it reached the network: AMBIGUOUS, never the REJECTED a config error gets.
    return {
      ...failedResult(err, medium, params),
      retryable: undefined,
      outcome: 'AMBIGUOUS',
      provider: name,
      ...from,
    };
  }
}

/**
 * What a log row records about who sent it, so Check status asks the right account (#3344, #3350):
 * the vendor's name and, for a send on the platform's own keys, `source: 'platform'`. Names only,
 * never a key or message text (Rule 13). One place, so every writer stays in step.
 */
export function sendOriginMetadata(result: Pick<CommunicationSendResult, 'provider' | 'source'>): {
  provider?: string;
  source?: CommunicationSendResult['source'];
} {
  return {
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.source ? { source: result.source } : {}),
  };
}
