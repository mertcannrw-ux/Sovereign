/**
 * SSRF protection for outbound HTTP requests.
 * Validates URLs, resolves DNS, and rejects private/metadata addresses.
 */
import { Resolver } from 'dns';

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const isIPv4 = (ip: string) => IPV4_REGEX.test(ip);
const isIPv6 = (ip: string) => !isIPv4(ip) && ip.includes(':');

// ─── Blocked IP ranges ────────────────────────────────────

const PRIVATE_RANGES = [
  // IPv4 private ranges
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] },
  // Loopback
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] },
  // Link-local
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] },
  // Multicast
  { start: [224, 0, 0, 0], end: [239, 255, 255, 255] },
  // Cloud metadata
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
  // ULA (fc00::/7)
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
  return true; // Unknown format = block
}

// ─── URL validation ───────────────────────────────────────

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

export function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  // Only allow HTTPS for custom endpoints
  if (parsed.protocol !== 'https:') {
    throw new SsrfError('Only HTTPS URLs are allowed');
  }

  // Reject credentials in URL
  if (parsed.username || parsed.password) {
    throw new SsrfError('URLs with credentials are not allowed');
  }

  // Reject non-default ports (only 443 for HTTPS)
  if (parsed.port && parsed.port !== '443' && parsed.port !== '') {
    throw new SsrfError('Non-default ports are not allowed');
  }

  // Reject fragments
  if (parsed.hash) {
    throw new SsrfError('URLs with fragments are not allowed');
  }

  return parsed;
}

export async function validateOutboundUrl(url: string): Promise<URL> {
  const parsed = validateUrl(url);

  // Resolve DNS and check all addresses
  const resolver = new Resolver();
  resolver.setServers(['8.8.8.8', '1.1.1.1']);

  return new Promise((resolve, reject) => {
    resolver.resolve4(parsed.hostname, (err, addresses) => {
      if (err) {
        // If DNS resolution fails for A records, try AAAA
        resolver.resolve6(parsed.hostname, (err6, ipv6Addresses) => {
          if (err6) {
            reject(new SsrfError('DNS resolution failed'));
            return;
          }
          for (const addr of ipv6Addresses) {
            if (isPrivateIP(addr)) {
              reject(new SsrfError(`Private IP address blocked: ${addr}`));
              return;
            }
          }
          resolve(parsed);
        });
        return;
      }

      for (const addr of addresses) {
        if (isPrivateIP(addr)) {
          reject(new SsrfError(`Private IP address blocked: ${addr}`));
          return;
        }
      }
      resolve(parsed);
    });
  });
}

// ─── Provider URL validation (for AI gateway) ─────────────

const PROVIDER_ORIGINS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  mistral: 'https://api.mistral.ai',
  groq: 'https://api.groq.com',
};

export function getProviderOrigin(provider: string): string | null {
  return PROVIDER_ORIGINS[provider] ?? null;
}
