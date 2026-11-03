import dns from 'node:dns/promises';
import net from 'node:net';

export class SSRFBlockedError extends Error {
  public readonly url: string;
  public readonly reason: string;

  constructor(url: string, reason: string) {
    super(`SSRF blocked for URL "${url}": ${reason}`);
    this.name = 'SSRFBlockedError';
    this.url = url;
    this.reason = reason;
  }
}

/**
 * Checks whether an IPv4 address is in a private, loopback, link-local, or reserved range.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // invalid IPv4 treated as unsafe
  }

  const [p0 = 0, p1 = 0] = parts;

  // 127.0.0.0/8 (Loopback)
  if (p0 === 127) return true;

  // 10.0.0.0/8 (Private)
  if (p0 === 10) return true;

  // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (p0 === 192 && p1 === 168) return true;

  // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Cloud Metadata: 169.254.169.254)
  if (p0 === 169 && p1 === 254) return true;

  // 0.0.0.0/8 (Current network / default)
  if (p0 === 0) return true;

  // 100.64.0.0/10 (Carrier-grade NAT: 100.64.0.0 - 100.127.255.255)
  if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;

  // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
  if (p0 >= 224 && p0 <= 239) return true;

  // 240.0.0.0/4 & 255.255.255.255 (Reserved & Broadcast)
  if (p0 >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is in a private, loopback, link-local, or reserved range.
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // ::1 (Loopback) & :: (Unspecified)
  if (normalized === '::1' || normalized === '::') return true;

  // IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.slice(7);
    if (net.isIPv4(ipv4Part)) {
      return isPrivateIPv4(ipv4Part);
    }
  }

  // fe80::/10 (Link-local)
  if (/^fe[89ab]/i.test(normalized)) return true;

  // fc00::/7 (Unique local address: fc00:: - fdff::)
  if (/^f[cd]/i.test(normalized)) return true;

  // ff00::/8 (Multicast)
  if (normalized.startsWith('ff')) return true;

  return false;
}

export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // Unknown IP formats are rejected
}

/**
 * Validates a URL against strict security criteria:
 * - Must use http or https protocol
 * - Must not be localhost or private hostname
 * - Must resolve via DNS to non-private, non-metadata IP addresses
 */
export async function validateUrlSecurity(urlString: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new SSRFBlockedError(urlString, 'Malformed URL');
  }

  // 1. Protocol whitelist
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SSRFBlockedError(
      urlString,
      `Disallowed protocol "${url.protocol}". Only http: and https: are allowed.`,
    );
  }

  const hostname = url.hostname.toLowerCase();

  // 2. Direct localhost check
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0') {
    throw new SSRFBlockedError(urlString, `Direct localhost access is blocked: "${hostname}"`);
  }

  // 3. Known cloud metadata and internal domains (blocks immediately without waiting on DNS)
  const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.lan', '.corp', '.home', '.arpa'];
  const BLOCKED_HOSTNAMES = new Set([
    'metadata.google.internal',
    'metadata',
    'instance-data',
    'kubernetes.default',
    'kubernetes.default.svc',
  ]);

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new SSRFBlockedError(
      urlString,
      `Access to internal/metadata domain is blocked: "${hostname}"`,
    );
  }

  // 4. Direct IP address check in hostname
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new SSRFBlockedError(
        urlString,
        `Direct access to private/reserved IP is blocked: "${hostname}"`,
      );
    }
    return url;
  }

  // 4. DNS resolution to check resolved IP addresses
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      throw new SSRFBlockedError(
        urlString,
        `DNS resolution returned no addresses for "${hostname}"`,
      );
    }

    for (const record of records) {
      if (isPrivateIP(record.address)) {
        throw new SSRFBlockedError(
          urlString,
          `Hostname "${hostname}" resolves to private/reserved address: "${record.address}"`,
        );
      }
    }
  } catch (err: unknown) {
    if (err instanceof SSRFBlockedError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new SSRFBlockedError(urlString, `DNS resolution failed: ${msg}`);
  }

  return url;
}
