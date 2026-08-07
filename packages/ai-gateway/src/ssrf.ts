/**
 * SSRF protection for outbound AI provider HTTP requests.
 *
 * Validates URLs before making requests: requires HTTPS, blocks credentials/
 * fragments/non-default ports, resolves DNS, and rejects private/metadata IPs.
 */
import { promises as dns } from 'dns';

// ─── IP address helpers ────────────────────────────────────

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isIPv4 = (ip: string) => IPV4_RE.test(ip);
const isIPv6 = (ip: string) => !isIPv4(ip) && ip.includes(':');

/**
 * RFC 1918, loopback, link-local, multicast, and cloud metadata ranges.
 *
 * Checks use packed integer comparison for IPv4.
 */
const PRIVATE_RANGES = [
  // RFC 1918
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] },
  // Loopback
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] },
  // Link-local
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] },
  // Multicast
  { start: [224, 0, 0, 0], end: [239, 255, 255, 255] },
  // Cloud metadata (inside link-local range, checked first)
  { start: [169, 254, 169, 254], end: [169, 254, 169, 254] },
];

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipToNumber(ip);
  return PRIVATE_RANGES.some(
    (range) => ipToNumber(range.start.join('.')) <= num && num <= ipToNumber(range.end.join('.')),
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback
  if (lower === '::1') return true;
  // Link-local
  if (lower.startsWith('fe80:')) return true;
  // Unique Local Address (ULA fc00::/7)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // IPv4-mapped IPv6
  if (lower.startsWith('::ffff:')) {
    const ipv4 = lower.slice(7);
    if (isIPv4(ipv4)) return isPrivateIPv4(ipv4);
  }
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIPv4(ip);
  if (isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // Unknown format – block
}

// ─── URL validation ────────────────────────────────────────

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Synchronous URL validation — checks scheme, credentials, port, fragments.
 * Does NOT perform DNS resolution.
 */
export function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  // Require HTTPS
  if (parsed.protocol !== 'https:') {
    throw new SsrfError('Only HTTPS URLs are allowed');
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    throw new SsrfError('URLs with credentials are not allowed');
  }

  // Reject non-default ports
  if (parsed.port && parsed.port !== '443') {
    throw new SsrfError('Non-default ports are not allowed');
  }

  // Reject fragments
  if (parsed.hash) {
    throw new SsrfError('URLs with fragments are not allowed');
  }

  return parsed;
}

/**
 * Full SSRF validation: synchronous checks + DNS resolution.
 * Resolves both A (IPv4) and AAAA (IPv6) records and blocks every
 * private/loopback/link-local/ULA/multicast/metadata address.
 */
export async function validateOutboundUrl(url: string): Promise<URL> {
  const parsed = validateUrl(url);

  await resolveHostname(parsed.hostname);

  return parsed;
}


// ─── DNS resolution ───────────────────────────────────────

async function resolveHostname(hostname: string): Promise<void> {
  // Use dns.lookup (getaddrinfo) instead of resolve4/resolve6 because
  // some environments (e.g. Windows with certain network configs) have
  // working OS-level resolution but reject direct DNS queries.
  let addresses;
  try {
    const result = await dns.lookup(hostname, { all: true });
    addresses = result;
  } catch {
    throw new SsrfError('DNS resolution failed');
  }

  for (const entry of addresses) {
    if (isPrivateIP(entry.address)) {
      throw new SsrfError(`Private IP address blocked: ${entry.address}`);
    }
  }
}
