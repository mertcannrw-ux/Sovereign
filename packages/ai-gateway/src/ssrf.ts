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
  // F-12: 0.0.0.0/8 — Linux treats as localhost alias
  { start: [0, 0, 0, 0], end: [0, 255, 255, 255] },
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

// F-23: precompute numeric bounds once so isPrivateIPv4 doesn't redo join+parse per range
const PRIVATE_RANGES_NUM: { startNum: number; endNum: number }[] = PRIVATE_RANGES.map((r) => ({
  startNum: ipToNumber(r.start.join('.')),
  endNum: ipToNumber(r.end.join('.')),
}));

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipToNumber(ip);
  return PRIVATE_RANGES_NUM.some((r) => r.startNum <= num && num <= r.endNum);
}

function expandIPv6(ip: string): string {
  const halves = ip.split('::');
  if (halves.length === 1) return ip;
  const left = halves[0] ? halves[0]!.split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1]!.split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  return [...left, ...Array(missing).fill('0'), ...right].join(':');
}

function isLoopbackIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  const expanded = expandIPv6(lower);
  const groups = expanded.split(':');
  if (groups.length !== 8) return false;
  return groups.slice(0, 7).every((g) => /^0+$/.test(g)) && /^0*1$/.test(groups[7]!);
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback (F-12: handles ::1 and uncompressed forms)
  if (isLoopbackIPv6(lower)) return true;
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
 * F-21: allows http:// for local Ollama (localhost / 127.x.x.x / ::1) and
 * permits the Ollama default port 11434 when explicitly configured via options.
 */
export function validateUrl(url: string, options?: { allowHttpLocalhost?: boolean }): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  const isLocalHost =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1' ||
    parsed.hostname.startsWith('127.');

  // F-21: permit http for localhost/loopback or when caller opts in (e.g. Ollama http://localhost:11434)
  const allowHttp = options?.allowHttpLocalhost ?? isLocalHost;
  if (parsed.protocol === 'http:' && !allowHttp) {
    throw new SsrfError('Only HTTPS URLs are allowed');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SsrfError('Only HTTPS URLs are allowed');
  }

  // Reject embedded credentials
  if (parsed.username || parsed.password) {
    throw new SsrfError('URLs with credentials are not allowed');
  }

  // Reject non-default ports — except 11434 (Ollama) and localhost http
  const allowedPorts = new Set(['', '443', '11434']);
  if (parsed.port && !allowedPorts.has(parsed.port) && !isLocalHost) {
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
 * Returns the validated IP addresses so the caller can pin them for the
 * subsequent fetch, eliminating the DNS-rebinding TOCTOU window.
 */
export async function validateOutboundUrl(
  url: string,
): Promise<{ url: URL; addresses: string[] }> {
  const parsed = validateUrl(url);
  // Local/loopback hosts (localhost, 127.*, ::1) are trusted by policy
  // (F-21 / Ollama) and cannot resolve to an unexpected public IP, so DNS
  // rebinding is not a concern. Skip resolution + IP pinning for them —
  // otherwise legitimate local endpoints like http://localhost:11434 would be
  // blocked (regression N-1).
  if (isLocalHostname(parsed)) {
    return { url: parsed, addresses: [] };
  }
  const addresses = await resolveHostnameValidated(parsed.hostname);
  return { url: parsed, addresses };
}

function isLocalHostname(parsed: URL): boolean {
  const host = parsed.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.');
}


// ─── DNS resolution ───────────────────────────────────────

async function resolveHostnameValidated(hostname: string): Promise<string[]> {
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

  const validIPs: string[] = [];
  for (const entry of addresses) {
    if (isPrivateIP(entry.address)) {
      throw new SsrfError(`Private IP address blocked: ${entry.address}`);
    }
    validIPs.push(entry.address);
  }
  return validIPs;
}
