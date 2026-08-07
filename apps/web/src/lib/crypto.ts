import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { TRPCError } from '@trpc/server';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const hexKey = process.env.API_KEY_ENCRYPTION_KEY;
  if (!hexKey) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'API key encryption is not configured (missing API_KEY_ENCRYPTION_KEY)',
    });
  }
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== KEY_LENGTH) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'API_KEY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)',
    });
  }
  return buf;
}

/**
 * Encrypts a plaintext API key using AES-256-GCM.
 * Returns a colon-delimited string: iv:authTag:ciphertext (all hex-encoded).
 */
export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an API key that was encrypted with {@link encryptApiKey}.
 */
export function decryptApiKey(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let plaintext = decipher.update(ciphertext!, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

/**
 * Masks an API key for display, showing only the first and last few characters.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}...${key.slice(-3)}`;
}
