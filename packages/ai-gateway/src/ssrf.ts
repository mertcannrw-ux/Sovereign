/**
 * SSRF protection for outbound AI provider HTTP requests.
 *
 * Public custom providers must be HTTPS (any port). HTTP is allowed only for
 * literal loopback so local OpenAI-compatible servers (Ollama, vLLM, LM Studio)
 * still work. Credentials and fragments are rejected. Non-loopback hosts are
 * DNS-resolved and private/metadata IPs are blocked.
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

function isLoopbackIPv4(ip: string): boolean {
  const match = IPV4_RE.exec(ip);
  if (!match) return false;
  const octets = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if (octets.some((n) => n > 255)) return false;
  return octets[0] === 127;
}

/**
 * True loopback only. A hostname prefix like `127.` is not an IP and can
 * resolve anywhere (e.g. `127.0.0.1.nip.io`).
 */
function unwrapHostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = unwrapHostname(hostname).toLowerCase();
  if (host === 'localhost') return true;
  if (isLoopbackIPv6(host)) return true;
  return isLoopbackIPv4(host);
}

// ─── URL validation ────────────────────────────────────────

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Synchronous URL validation — scheme, credentials, fragments.
 * Does NOT perform DNS resolution. HTTP is allowed for literal loopback
 * so custom local providers work. Remote custom providers may use any HTTPS port.
 */
export function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  const isLocalHost = isLoopbackHostname(parsed.hostname);

  if (parsed.protocol === 'http:' && !isLocalHost) {
    throw new SsrfError('Only HTTPS URLs are allowed');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SsrfError('Only HTTPS URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new SsrfError('URLs with credentials are not allowed');
  }

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
  // Literal loopback cannot rebind to another address, so skip DNS pinning.
  // Blocking it would reject local custom providers (Ollama, vLLM, etc.).
  if (isLoopbackHostname(parsed.hostname)) {
    return { url: parsed, addresses: [] };
  }
  const addresses = await resolveHostnameValidated(parsed.hostname);
  return { url: parsed, addresses };
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
