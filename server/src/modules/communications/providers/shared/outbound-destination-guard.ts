import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Blocks outbound provider requests (SMS gateway `apiUrl`, SMTP `host`)
 * from reaching an internal/private address. A tenant-custom `apiUrl` is
 * an intentionally supported feature (see `greenweb.provider.spec.ts`'s
 * `'uses a tenant-configured apiUrl when given'` test) — a domain
 * allowlist would break it — so this checks the *class* of address
 * (private/loopback/link-local/metadata) rather than the hostname itself.
 *
 * Resolves the hostname via `dns.lookup` and returns the validated
 * address(es) to the caller instead of discarding them — a hostname
 * re-resolved independently by the real connection could return something
 * else entirely (DNS rebinding: a tenant controls DNS for their own
 * domain, so a short TTL or an alternating resolver is enough to make
 * this check pass against a public IP while the real connection lands on
 * `169.254.169.254` or another internal address moments later). Callers
 * pin the actual connection to exactly what was validated here — see
 * `pinned-http.ts` for HTTP (undici `connect.lookup`) and
 * `smtp.provider.ts` for SMTP (validated IP as `host`, original
 * hostname kept as `tls.servername` for SNI/cert validation).
 */

/** Common base for both error kinds below — callers that only need the
 * human-readable reason (e.g. surfacing a connection-test failure) can
 * catch this instead of the two subclasses individually. */
export abstract class OutboundDestinationError extends Error {
  /** Fixed text to show a user (Rule 23): `message` can carry the submitted address. */
  abstract readonly publicMessage: string;
}

// A permanent policy violation — invalid URL, wrong scheme, out-of-range
// port, or a hostname that resolves to a private/reserved address. This
// destination will not become valid on retry, so callers may treat it as
// non-retryable.
export class DestinationBlockedError extends OutboundDestinationError {
  readonly publicMessage = 'This server address cannot be used — check it and try again.';
  constructor(reason: string) {
    super(`Outbound destination blocked: ${reason}`);
    this.name = 'DestinationBlockedError';
  }
}

// The DNS lookup itself failed — transient (resolver hiccup, momentary
// outage). Unlike DestinationBlockedError, this hostname may resolve
// successfully on a later attempt, so callers should keep it retryable.
export class DestinationResolutionError extends OutboundDestinationError {
  readonly publicMessage = 'This server address could not be found — check it and try again.';
  constructor(hostname: string) {
    super(`"${hostname}" could not be resolved.`);
    this.name = 'DestinationResolutionError';
  }
}

// IPv4 private/reserved ranges, expressed as [network, prefixLength].
const PRIVATE_IPV4_RANGES: Array<[string, number]> = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. the 169.254.169.254 cloud metadata address
  ['100.64.0.0', 10], // carrier-grade NAT
  ['0.0.0.0', 8],
];

// Plain arithmetic rather than bitwise ops — `<<`/`>>>` coerce to signed
// 32-bit ints in JS, which silently mis-masks any octet ≥ 128 (every
// range below has one). Everything here stays well under
// Number.MAX_SAFE_INTEGER, so floating-point division is exact.
function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function isPrivateIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([network, prefixLength]) => {
    const blockSize = 2 ** (32 - prefixLength);
    return Math.floor(ipInt / blockSize) === Math.floor(ipv4ToInt(network) / blockSize);
  });
}

// Link-local addresses are fe80::/10 — the first hextet ranges from
// 0xfe80 to 0xfebf. A plain `startsWith('fe80')` prefix check only
// catches fe80::/16, letting fe90::, fea0::, febf::, etc. through.
function isIpv6LinkLocal(normalized: string): boolean {
  const firstHextet = normalized.split(':', 1)[0];
  if (!/^[0-9a-f]{1,4}$/.test(firstHextet)) return false;
  const value = parseInt(firstHextet, 16);
  return value >= 0xfe80 && value <= 0xfebf;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' || // loopback
    normalized.startsWith('fc') || // unique local fc00::/7
    normalized.startsWith('fd') ||
    isIpv6LinkLocal(normalized) || // link-local fe80::/10
    normalized === '::' ||
    normalized.startsWith('::ffff:127.') || // IPv4-mapped loopback
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:169.254.') ||
    normalized.startsWith('::ffff:192.168.')
  );
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  // Not a literal IP — caller resolves it via DNS before calling this.
  return false;
}

export interface PinnedAddress {
  address: string;
  family: number;
}

async function assertResolvesToPublicAddress(hostname: string): Promise<PinnedAddress[]> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new DestinationBlockedError(`"${hostname}" is a private/reserved address.`);
    }
    return [{ address: hostname, family: isIP(hostname) }];
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new DestinationResolutionError(hostname);
  }
  const privateHit = addresses.find(({ address }) => isPrivateAddress(address));
  if (privateHit) {
    throw new DestinationBlockedError(
      `"${hostname}" resolves to a private/reserved address (${privateHit.address}).`,
    );
  }
  return addresses;
}

// `URL#hostname` keeps the brackets around a literal IPv6 host (e.g.
// `[fe80::1]`) — neither `net.isIP` nor `dns.lookup` recognize that form,
// so a literal-IPv6 URL would otherwise silently skip the isIP() branch
// below and fail (or worse, hang) trying to DNS-resolve a bracketed string.
function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/** The origin drives the real connection's Host header and TLS SNI;
 * `addresses` are every address the guard validated as public — callers
 * pin the actual connection to these instead of letting it re-resolve. */
export interface SafeHttpDestination {
  url: URL;
  addresses: PinnedAddress[];
}

/** `addresses` are every address the guard validated as public, in
 * resolution order — callers should attempt them in order with bounded
 * fallback (nodemailer only fails over across multiple addresses when it
 * does its own DNS resolution; pinning to a single literal IP would
 * otherwise silently drop that resilience). `servername` is the original
 * hostname, for TLS SNI/cert validation — `undefined` when the input was
 * already a literal IP (nothing to put in SNI). */
export interface SafeSmtpDestination {
  addresses: PinnedAddress[];
  servername?: string;
}

/**
 * Test-only seam (#3324): lets the e2e server reach its local vendor stub over plain http.
 * Fails closed: both conditions must hold, read on every call, never cached. Boot refuses the
 * flag in production (`assertProductionConfig`). See 08-security.md Rule 7.
 */
function testLoopbackAllowed(): boolean {
  return (
    process.env.NODE_ENV === 'test' && process.env.OUTBOUND_TEST_ALLOW_LOOPBACK === 'true'
  );
}

/** For SMS gateway `apiUrl` values — used with `fetch()`. */
export async function assertSafeHttpDestination(rawUrl: string): Promise<SafeHttpDestination> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DestinationBlockedError(`"${rawUrl}" is not a valid URL.`);
  }
  // Only the literal 127.0.0.1 over http: - not `localhost`, not other private ranges, not https.
  if (testLoopbackAllowed() && url.protocol === 'http:' && url.hostname === '127.0.0.1') {
    return { url, addresses: [{ address: '127.0.0.1', family: 4 }] };
  }
  if (url.protocol !== 'https:') {
    throw new DestinationBlockedError(`"${rawUrl}" must use https:.`);
  }
  const addresses = await assertResolvesToPublicAddress(stripIpv6Brackets(url.hostname));
  return { url, addresses };
}

/** For SMTP `host`/`port` — no protocol concept, so no scheme check. */
export async function assertSafeSmtpDestination(
  host: string,
  port: number,
): Promise<SafeSmtpDestination> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DestinationBlockedError(`port ${port} is not a valid TCP port.`);
  }
  const addresses = await assertResolvesToPublicAddress(host);
  return { addresses, servername: isIP(host) ? undefined : host };
}
