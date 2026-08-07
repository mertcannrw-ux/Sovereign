/**
 * Versioned SecretService for encrypting/decrypting sensitive data.
 * Uses AES-256-GCM with key versioning for online rotation.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// ─── Types ────────────────────────────────────────────────

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export interface SecretMetadata {
  ownerType: string;
  ownerId: string;
  purpose: string;
}

// ─── Configuration ────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const CURRENT_KEY_VERSION = 1;

function getKeyForVersion(_version: number): Buffer {
  const hexKey = process.env.API_KEY_ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error('API_KEY_ENCRYPTION_KEY environment variable is required');
  }
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== 32) {
    throw new Error('API_KEY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  // In a real implementation, different versions would derive different keys.
  // For now, all versions use the same key.
  return buf;
}

// ─── Encryption ───────────────────────────────────────────

export function encryptSecret(
  plaintext: string,
  metadata: SecretMetadata,
  keyVersion: number = CURRENT_KEY_VERSION,
): EncryptedSecret {
  const key = getKeyForVersion(keyVersion);
  const iv = randomBytes(IV_LENGTH);

  // Encode associated data for authenticated encryption
  const aad = Buffer.from(JSON.stringify(metadata));

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  cipher.setAAD(aad);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag,
    keyVersion,
  };
}

// ─── Decryption ───────────────────────────────────────────

export function decryptSecret(encrypted: EncryptedSecret, metadata: SecretMetadata): string {
  const key = getKeyForVersion(encrypted.keyVersion);
  const iv = Buffer.from(encrypted.iv, 'hex');
  const authTag = Buffer.from(encrypted.authTag, 'hex');

  const aad = Buffer.from(JSON.stringify(metadata));

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  decipher.setAAD(aad);

  let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

// ─── Display mask (never reveals plaintext) ───────────────

export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return '****';
  return `${plaintext.slice(0, 3)}...${plaintext.slice(-4)}`;
}

/**
 * Returns the last 4 chars captured at save time.
 * This is stored separately from the encrypted value.
 */
export function captureLastFour(plaintext: string): string {
  return plaintext.slice(-4);
}

// ─── Legacy compatibility ─────────────────────────────────

/**
 * Encrypt an API key using the legacy format (iv:authTag:ciphertext).
 * Used for backward compatibility with existing encrypted keys.
 */
export function encryptApiKeyLegacy(plaintext: string): string {
  const key = getKeyForVersion(CURRENT_KEY_VERSION);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an API key using the legacy format.
 */
export function decryptApiKeyLegacy(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }
  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getKeyForVersion(CURRENT_KEY_VERSION);
  const iv = Buffer.from(ivHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let plaintext = decipher.update(ciphertext!, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}
