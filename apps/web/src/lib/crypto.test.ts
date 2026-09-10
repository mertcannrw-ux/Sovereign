// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptApiKey, decryptApiKey, maskApiKey } from './crypto';

const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

describe('crypto (BYOK API key encryption)', () => {
  const originalKey = process.env.API_KEY_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.API_KEY_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
    else process.env.API_KEY_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a plaintext key', () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
    expect(decryptApiKey(encryptApiKey(secret))).toBe(secret);
  });

  it('produces iv:authTag:ciphertext with random IVs', () => {
    const first = encryptApiKey('same-input');
    const second = encryptApiKey('same-input');

    expect(first.split(':')).toHaveLength(3);
    // A repeated IV under the same key would be a catastrophic GCM failure.
    expect(first).not.toBe(second);
    expect(decryptApiKey(first)).toBe(decryptApiKey(second));
  });

  it('rejects a tampered ciphertext (GCM authentication)', () => {
    const payload = encryptApiKey('sk-secret-value');
    const [iv, tag, ciphertext] = payload.split(':') as [string, string, string];
    const flipped = `${ciphertext.slice(0, -2)}${ciphertext.slice(-2) === '00' ? '01' : '00'}`;

    expect(() => decryptApiKey(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it('rejects a payload with the wrong number of parts', () => {
    expect(() => decryptApiKey('not-a-valid-payload')).toThrow(/Invalid encrypted payload/);
    expect(() => decryptApiKey('a:b')).toThrow(/Invalid encrypted payload/);
  });

  it('fails loudly when the key is not configured', () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    expect(() => encryptApiKey('x')).toThrow(/API_KEY_ENCRYPTION_KEY/);
  });

  it('rejects a key of the wrong length', () => {
    process.env.API_KEY_ENCRYPTION_KEY = 'abcd'; // 2 bytes
    expect(() => encryptApiKey('x')).toThrow(/64-character hex/);
  });

  it('cannot decrypt with a different key', () => {
    const payload = encryptApiKey('sk-secret-value');
    process.env.API_KEY_ENCRYPTION_KEY = 'b'.repeat(64);
    expect(() => decryptApiKey(payload)).toThrow();
  });
});

describe('maskApiKey', () => {
  it('never reveals the middle of the key', () => {
    const secret = 'sk-proj-SUPERSECRETMIDDLE-1234';
    const masked = maskApiKey(secret);

    expect(masked).toBe('sk-...234');
    expect(masked).not.toContain('SUPERSECRETMIDDLE');
  });

  it('fully masks short keys instead of exposing them', () => {
    expect(maskApiKey('short')).toBe('****');
    expect(maskApiKey('12345678')).toBe('****');
  });
});
