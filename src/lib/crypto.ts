import crypto from 'crypto';

function getKey(): Buffer {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error('APP_ENCRYPTION_KEY is not set');
  // Accept base64 or raw
  try {
    const b = Buffer.from(key, 'base64');
    if (b.length >= 32) return b.subarray(0, 32);
  } catch {
    // ignore
  }
  const raw = Buffer.from(key, 'utf8');
  if (raw.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY must be at least 32 bytes (or base64 for 32 bytes)');
  }
  return raw.subarray(0, 32);
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptString(ciphertextB64: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertextB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

