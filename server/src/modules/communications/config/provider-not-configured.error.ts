/**
 * Thrown by `MessagingConfigResolver` when neither a tenant setting nor an
 * env-var fallback resolves a provider's required fields (or the provider
 * name is unknown). The registry's `send` turns it into a REJECTED,
 * non-retryable `{ success: false, error: message }` result, and providers
 * that raise it themselves do the same — `CommunicationProvider.send()`'s
 * contract is that nothing throws past the provider boundary.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(medium: string, hint: string) {
    super(
      `${medium} is not configured for this tenant, and no platform-wide fallback is set. ${hint}`,
    );
    this.name = 'ProviderNotConfiguredError';
  }
}
