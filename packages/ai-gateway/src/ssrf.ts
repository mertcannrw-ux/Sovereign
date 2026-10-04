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

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const isIPv4 = (ip: string) => IPV4_RE.test(ip);
const isIPv6 = (ip: string) => !isIPv4(ip) && ip.includes(':');

/**
 * RFC 1918, loopback, link-local, multicast, CGNAT, benchmarking, reserved,
 * and cloud metadata ranges.
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
  // CGNAT (RFC 6598) — includes the Alibaba Cloud metadata address 100.100.100.200
  { start: [100, 64, 0, 0], end: [100, 127, 255, 255] },
  // Benchmarking (RFC 2544)
  { start: [198, 18, 0, 0], end: [198, 19, 255, 255] },
  // Reserved (RFC 1112) — includes the 255.255.255.255 broadcast address
  { start: [240, 0, 0, 0], end: [255, 255, 255, 255] },
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

/**
 * Parse an IPv6 address into its eight 16-bit groups. Handles compressed
 * (`::`), fully expanded, zone-scoped (`fe80::1%eth0`) and IPv4-embedded
 * (`::ffff:127.0.0.1`) forms. Returns null when the address is unparseable.
 */
function parseIPv6Groups(ip: string): number[] | null {
  let value = ip.toLowerCase();
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);

  // Rewrite a trailing dotted-quad as two hex groups so the rest of the
  // parser only deals with colon-separated groups.
  const lastColon = value.lastIndexOf(':');
  const tail = lastColon >= 0 ? value.slice(lastColon + 1) : value;
  if (tail.includes('.')) {
    const octets = tail.split('.');
    if (
      octets.length !== 4 ||
      octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
    ) {
      return null;
    }
    const [a, b, c, d] = octets.map(Number) as [number, number, number, number];
    const high = (((a << 8) | b) >>> 0).toString(16);
    const low = (((c << 8) | d) >>> 0).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter((part) => part !== '') : [];
  const right =
    halves.length === 2 && halves[1] ? halves[1].split(':').filter((part) => part !== '') : [];
  if (halves.length === 2) {
    if (8 - left.length - right.length < 0) return null;
  } else if (left.length !== 8) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? 8 - left.length - right.length : 0 }, () => '0'),
    ...right,
  ];
  if (groups.length !== 8) return null;

  const parsed = groups.map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );
  return parsed.some((group) => Number.isNaN(group)) ? null : parsed;
}

function groupsToIPv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * IPv6 private/reserved detection. Uses the parsed groups rather than string
 * prefixes so compressed, uncompressed, IPv4-embedded and NAT64/6to4/Teredo
 * forms cannot slip past the check.
 */
function isPrivateIPv6(ip: string): boolean {
  const groups = parseIPv6Groups(ip);
  // Fail closed: an address we cannot parse must not reach the network.
  if (!groups) return true;

  const g0 = groups[0]!;
  const g1 = groups[1]!;
  const g2 = groups[2]!;
  const g3 = groups[3]!;
  const g4 = groups[4]!;
  const g5 = groups[5]!;
  const g6 = groups[6]!;
  const g7 = groups[7]!;

  // ::/96 — unspecified `::`, loopback `::1`, and deprecated IPv4-compatible
  // forms (`::127.0.0.1`, `::7f00:1`).
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true;
  // ::ffff:0:0/96 — IPv4-mapped; inspect the embedded IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isPrivateIPv4(groupsToIPv4(g6, g7));
  }
  // Link-local fe80::/10 and deprecated site-local fec0::/10.
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true;
  // Unique local fc00::/7.
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // Multicast ff00::/8.
  if ((g0 & 0xff00) === 0xff00) return true;
  // NAT64 64:ff9b::/96 — inspect the embedded IPv4 address.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4(groupsToIPv4(g6, g7));
  }
  // 6to4 2002::/16 — the next 32 bits carry the embedded IPv4 address.
  if (g0 === 0x2002) return isPrivateIPv4(groupsToIPv4(g1, g2));
  // Teredo 2001:0000::/32 — the next 32 bits carry the Teredo server IPv4.
  if (g0 === 0x2001 && g1 === 0x0000) return isPrivateIPv4(groupsToIPv4(g2, g3));
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIPv4(ip);
  if (isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // Unknown format – block
}

/** Return whether a valid dotted-decimal IPv4 address belongs to the 127.0.0.0/8 loopback range. */
function isLoopbackIPv4(ip: string): boolean {
  if (!isIPv4(ip)) return false;
  // `IPV4_RE` already enforces 0-255, so no further range check is needed.
  return ip.split('.')[0] === '127';
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

/**
 * Loopback custom providers (Ollama, vLLM) are a local-dev convenience.
 * In production they are SSRF to the host unless the operator opts in.
 */
export function loopbackProvidersAllowed(): boolean {
  const flag = process.env.ALLOW_LOOPBACK_PROVIDERS;
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

export type ValidateUrlOptions = {
  /** Override the ALLOW_LOOPBACK_PROVIDERS / NODE_ENV policy. */
  allowLoopback?: boolean;
};

// ─── URL validation ────────────────────────────────────────

/**
 * Why a URL was refused. Callers switch on this rather than on the message:
 * `loopback_blocked` is the one failure an operator can fix by configuration
 * (and the only one worth naming verbatim to a user), while the rest describe
 * attempts that should stay opaque outside the server log.
 */
export type SsrfReason =
  | 'loopback_blocked'
  | 'invalid_url'
  | 'scheme'
  | 'credentials'
  | 'fragment'
  | 'private_ip'
  | 'dns_failure';

export class SsrfError extends Error {
  readonly reason: SsrfReason;

  /** Create an SSRF rejection with a machine-readable reason and explanatory message. */
  constructor(reason: SsrfReason, message: string) {
    super(message);
    this.name = 'SsrfError';
    this.reason = reason;
  }
}

/**
 * Synchronous URL validation — scheme, credentials, fragments.
 * Does NOT perform DNS resolution. HTTP is allowed for literal loopback
 * so custom local providers work. Remote custom providers may use any HTTPS port.
 */
export function validateUrl(url: string, options?: ValidateUrlOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError('invalid_url', 'Invalid URL');
  }

  const isLocalHost = isLoopbackHostname(parsed.hostname);
  const allowLoopback = options?.allowLoopback ?? loopbackProvidersAllowed();

  if (isLocalHost && !allowLoopback) {
    throw new SsrfError(
      'loopback_blocked',
      'Loopback URLs are not allowed. Set ALLOW_LOOPBACK_PROVIDERS=true to use a local provider (Ollama, vLLM) on a host that runs one.',
    );
  }

  if (parsed.protocol === 'http:' && !isLocalHost) {
    throw new SsrfError('scheme', 'Only HTTPS URLs are allowed');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new SsrfError('scheme', 'Only HTTPS URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new SsrfError('credentials', 'URLs with credentials are not allowed');
  }

  if (parsed.hash) {
    throw new SsrfError('fragment', 'URLs with fragments are not allowed');
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
  options?: ValidateUrlOptions,
): Promise<{ url: URL; addresses: string[] }> {
  const parsed = validateUrl(url, options);
  // Literal loopback cannot rebind to another address, so skip DNS pinning.
  // Only reachable when loopback is explicitly allowed.
  if (isLoopbackHostname(parsed.hostname)) {
    return { url: parsed, addresses: [] };
  }
  const addresses = await resolveHostnameValidated(parsed.hostname);
  return { url: parsed, addresses };
}

// ─── DNS resolution ───────────────────────────────────────

/** Resolve all host addresses, rejecting DNS failures or any private address with SsrfError. */
async function resolveHostnameValidated(hostname: string): Promise<string[]> {
  // Use dns.lookup (getaddrinfo) instead of resolve4/resolve6 because
  // some environments (e.g. Windows with certain network configs) have
  // working OS-level resolution but reject direct DNS queries.
  let addresses;
  try {
    const result = await dns.lookup(hostname, { all: true });
    addresses = result;
  } catch {
    throw new SsrfError('dns_failure', 'DNS resolution failed');
  }

  const validIPs: string[] = [];
  for (const entry of addresses) {
    if (isPrivateIP(entry.address)) {
      throw new SsrfError('private_ip', `Private IP address blocked: ${entry.address}`);
    }
    validIPs.push(entry.address);
  }
  return validIPs;
}
