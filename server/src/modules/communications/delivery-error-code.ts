/**
 * [2683] `CommunicationLog.metadata.error` holds raw worker/provider text (`err.message`,
 * a gateway's own error string). That text can carry gateway URLs, account ids or
 * recipient details, so an API response never returns it (Rule 23). It returns one of
 * these fixed codes instead; the raw text stays in the row and the logs.
 *
 * Example: `'SMS (Greenweb) is not configured for this tenant, …'` → `'NOT_CONFIGURED'`.
 */
export const DELIVERY_ERROR_CODES = ['NOT_CONFIGURED', 'NO_PROVIDER', 'FAILED'] as const;
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

export function deliveryErrorCode(metadata: unknown): DeliveryErrorCode | null {
  const meta = metadata as { error?: unknown; delivery?: { status?: unknown } } | null | undefined;
  const raw = meta?.error;
  if (typeof raw !== 'string' || raw === '') {
    // #3351: Check status recorded the vendor's "not delivered" under `delivery`, not `error`.
    // FAILED only: the vendor's own `delivery.code` never reaches the response (Rule 23).
    return meta?.delivery?.status === 'FAILED' ? 'FAILED' : null;
  }
  // Sentences from provider-not-configured.error.ts and communications.processor.ts.
  if (/is not configured for this tenant/i.test(raw)) return 'NOT_CONFIGURED';
  if (/^No provider registered/i.test(raw)) return 'NO_PROVIDER';
  return 'FAILED';
}
