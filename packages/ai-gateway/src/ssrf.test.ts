import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());

vi.mock('dns', () => ({
  promises: { lookup },
}));

import { validateUrl, validateOutboundUrl, SsrfError } from './ssrf';

function expectSsrf(url: string, message?: string | RegExp) {
  expect(() => validateUrl(url)).toThrow(SsrfError);
  if (message) {
    expect(() => validateUrl(url)).toThrow(message);
  }
}

describe('validateUrl', () => {
  it('allows remote custom OpenAI-compatible HTTPS endpoints, including non-443 ports', () => {
    expect(validateUrl('https://api.example.com/v1').hostname).toBe('api.example.com');
    expect(validateUrl('https://openrouter.ai/api/v1').pathname).toBe('/api/v1');
    expect(validateUrl('https://litellm.example.com:4000/v1').port).toBe('4000');
    expect(validateUrl('https://proxy.example.com:8443/v1').port).toBe('8443');
  });

  it('allows HTTP and any port on literal loopback for local custom providers', () => {
    expect(validateUrl('http://localhost:11434').hostname).toBe('localhost');
    expect(validateUrl('http://127.0.0.1:11434/api/chat').port).toBe('11434');
    expect(validateUrl('http://127.0.0.1:8000/v1').port).toBe('8000');
    expect(validateUrl('http://127.0.0.2:1234').hostname).toBe('127.0.0.2');
    expect(() => validateUrl('http://[::1]:11434')).not.toThrow();
    expect(validateUrl('https://localhost:1234').protocol).toBe('https:');
  });

  it('does not treat 127. hostname prefixes as loopback', () => {
    expectSsrf('http://127.0.0.1.nip.io', 'Only HTTPS URLs are allowed');
    expectSsrf('http://127.attacker.example', 'Only HTTPS URLs are allowed');
    expectSsrf('http://127.0.0.1.example.com', 'Only HTTPS URLs are allowed');
  });

  it('rejects cleartext HTTP to non-loopback hosts', () => {
    expectSsrf('http://api.example.com/v1', 'Only HTTPS URLs are allowed');
    expectSsrf('http://192.168.1.10:8000/v1', 'Only HTTPS URLs are allowed');
  });

  it('rejects credentials and fragments', () => {
    expectSsrf('https://user:pass@api.example.com/v1', 'credentials');
    expectSsrf('https://api.example.com/v1#frag', 'fragments');
  });

  it('rejects non-http(s) schemes', () => {
    expectSsrf('ftp://api.example.com/v1');
    expectSsrf('file:///etc/passwd');
  });
});

describe('validateOutboundUrl', () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  it('skips DNS for literal loopback so local custom providers are not blocked', async () => {
    const result = await validateOutboundUrl('http://127.0.0.1:11434/api/chat');
    expect(result.addresses).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips DNS for localhost', async () => {
    const result = await validateOutboundUrl('http://localhost:8000/v1');
    expect(result.addresses).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('pins public custom-provider hosts after DNS', async () => {
    lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
    const result = await validateOutboundUrl('https://api.example.com:8443/v1');
    expect(result.addresses).toEqual(['203.0.113.10']);
    expect(lookup).toHaveBeenCalled();
  });

  it('blocks 127-prefix hostnames that resolve to a private address', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(validateOutboundUrl('https://127.0.0.1.nip.io/v1')).rejects.toThrow(
      /Private IP address blocked/,
    );
  });

  it('blocks cloud metadata addresses', async () => {
    lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    await expect(validateOutboundUrl('https://metadata.example/latest')).rejects.toThrow(
      /Private IP address blocked/,
    );
  });

  // Regression: string-prefix checks missed unspecified (`::`), compressed
  // IPv4-compatible (`::127.0.0.1`, `::7f00:1`), site-local, multicast, NAT64,
  // 6to4 and Teredo forms. Every case below previously passed validation.
  const privateIpv6Literals: Array<[string, string]> = [
    ['unspecified', '::'],
    ['IPv4-compatible loopback', '::127.0.0.1'],
    ['IPv4-compatible hex loopback', '::7f00:1'],
    ['IPv4-mapped hex loopback', '::ffff:7f00:1'],
    ['link-local inside fe80::/10', 'fe90::1'],
    ['deprecated site-local', 'fec0::1'],
    ['multicast', 'ff02::1'],
    ['NAT64-mapped loopback', '64:ff9b::127.0.0.1'],
    ['6to4-embedded loopback', '2002:7f00:0001::1'],
    ['Teredo-embedded loopback', '2001:0000:7f00:0001::1'],
  ];

  for (const [label, address] of privateIpv6Literals) {
    it(`blocks ${label} IPv6 address ${address}`, async () => {
      lookup.mockResolvedValue([{ address, family: 6 }]);
      await expect(validateOutboundUrl(`https://[${address}]/`)).rejects.toThrow(SsrfError);
    });
  }

  it('still allows public IPv6 addresses', async () => {
    lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }]);
    const result = await validateOutboundUrl('https://[2606:4700:4700::1111]/');
    expect(result.addresses).toEqual(['2606:4700:4700::1111']);
  });

  it('rejects loopback when ALLOW_LOOPBACK_PROVIDERS is false', async () => {
    const previous = process.env.ALLOW_LOOPBACK_PROVIDERS;
    process.env.ALLOW_LOOPBACK_PROVIDERS = 'false';
    try {
      expect(() => validateUrl('http://127.0.0.1:11434')).toThrow(/Loopback URLs are not allowed/);
      await expect(validateOutboundUrl('http://localhost:11434')).rejects.toThrow(
        /Loopback URLs are not allowed/,
      );
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LOOPBACK_PROVIDERS;
      else process.env.ALLOW_LOOPBACK_PROVIDERS = previous;
    }
  });

  it('never allows loopback when allowLoopback is false, even in development', async () => {
    await expect(
      validateOutboundUrl('http://127.0.0.1/secret', { allowLoopback: false }),
    ).rejects.toThrow(/Loopback URLs are not allowed/);
  });
});
