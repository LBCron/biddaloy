/**
 * Maps a Meta Graph API error response to an actionable message, shared by
 * `MetaCloudProvider` and `MetaPageProvider`'s connection tests — both
 * ride the same Graph API and use the same error-code shape. Never returns
 * `data.error.message` verbatim: Meta's own error text can echo back
 * request details, and #8.7.12's contract is "never a raw provider
 * payload that might echo the credential back."
 *
 * Code reference: https://developers.facebook.com/docs/graph-api/guides/error-handling
 * (190 = expired/invalid token, 100 = missing/invalid parameter, which
 * covers "this phone number id / page id doesn't exist or isn't
 * accessible with this token").
 */
export function mapMetaGraphError(data: unknown): string {
  const code = (data as { error?: { code?: number } } | null)?.error?.code;

  if (code === 190) {
    return 'Authentication rejected — check the access token.';
  }
  if (code === 100) {
    return 'Not found — check the ID and that the token has access to it.';
  }
  return 'Connection test failed — could not verify the credentials.';
}
