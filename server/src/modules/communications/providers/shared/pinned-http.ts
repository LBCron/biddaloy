import type { LookupFunction } from 'node:net';
import { Client, fetch, type RequestInit } from 'undici';
import type { PinnedAddress, SafeHttpDestination } from './outbound-destination-guard';

/** Builds a `LookupFunction` that never performs a real DNS lookup — it
 * ignores the hostname it's asked about and answers only from `addresses`,
 * the list `outbound-destination-guard.ts` already validated as public.
 * This is what actually closes the DNS-rebinding gap: a second, differently
 * -answering DNS query can never reach the real connection. */
export function createPinnedLookup(addresses: readonly PinnedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    // `family` may be `4`/`6`, the string aliases, or `0`/undefined
    // meaning "either" — only `4`/`6` (however spelled) narrow the list.
    const requestedFamily =
      options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family || undefined;
    const matches = requestedFamily
      ? addresses.filter((a) => a.family === requestedFamily)
      : addresses;

    if (matches.length === 0) {
      const err = Object.assign(new Error('ENOTFOUND: no pinned address for requested family'), {
        code: 'ENOTFOUND',
      });
      callback(err, []);
      return;
    }

    if (options.all) {
      callback(null, matches.slice());
    } else {
      callback(null, matches[0].address, matches[0].family);
    }
  };
}

/** The server's one SSRF-safe outbound HTTP path: any URL a user or tenant
 * can influence goes through `assertSafeHttpDestination` + this function.
 * `server/src/outbound-http.contract.spec.ts` fails CI on any other outbound
 * call that is not on its reviewed list of constant-host / operator-config
 * files. Returns the JSON body only; `fetchPinnedJsonWithStatus` adds the HTTP status.
 *
 * Fetches JSON from `requestUrl` with the connection pinned to
 * `destination`'s already-validated addresses — the DNS-rebinding fix.
 * `requestUrl` must share `destination.url`'s origin (defense-in-depth:
 * callers append a query string after validation, so it's never literally
 * the same URL object, but it must never drift to a different origin). */
export async function fetchPinnedJson(
  destination: SafeHttpDestination,
  requestUrl: string,
  init?: RequestInit,
): Promise<unknown> {
  const { body } = await fetchPinnedJsonWithStatus(destination, requestUrl, init);
  // Only a non-2xx answer can come back without a body; this caller cannot see the status.
  if (body === undefined) throw new Error('The response was not JSON.');
  return body;
}

/**
 * #3320: `fetchPinnedJson` plus the HTTP status, for callers whose meaning depends on it (an SMS
 * provider: 401 releases the credit, 5xx keeps it held). Same origin check, pinning and
 * `redirect: 'error'`. A non-2xx answer that is not JSON (a 404 or 502 HTML page) returns
 * `body: undefined`; a 2xx that is not JSON still throws, as before.
 */
export async function fetchPinnedJsonWithStatus(
  destination: SafeHttpDestination,
  requestUrl: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  if (new URL(requestUrl).origin !== destination.url.origin) {
    throw new Error(
      `Refusing to fetch "${requestUrl}": origin does not match the validated destination "${destination.url.origin}".`,
    );
  }

  const client = new Client(destination.url.origin, {
    connect: { lookup: createPinnedLookup(destination.addresses) },
  });
  try {
    const response = await fetch(requestUrl, { ...init, redirect: 'error', dispatcher: client });
    const body: unknown = response.ok
      ? await response.json()
      : await response.json().catch(() => undefined);
    return { status: response.status, body };
  } finally {
    await client.destroy();
  }
}
