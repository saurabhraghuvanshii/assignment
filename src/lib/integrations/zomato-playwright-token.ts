import crypto from 'crypto';

type PlaywrightTokenPayload = {
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSigningKey(): Buffer {
  const secret = process.env.APP_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error('APP_ENCRYPTION_KEY or NEXTAUTH_SECRET must be set');
  }

  try {
    const decoded = Buffer.from(secret, 'base64');
    if (decoded.length >= 32) return decoded;
  } catch {
    // ignore base64 parse failure
  }

  return Buffer.from(secret, 'utf8');
}

function base64UrlEncode(input: Buffer | string): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLength), 'base64');
}

function sign(payloadB64: string): string {
  return base64UrlEncode(
    crypto.createHmac('sha256', getSigningKey()).update(payloadB64).digest()
  );
}

export function createZomatoPlaywrightToken(
  userId: string,
  ttlMs: number = DEFAULT_TTL_MS
): string {
  const now = Date.now();
  const payload: PlaywrightTokenPayload = {
    userId,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifyZomatoPlaywrightToken(
  token: string
): PlaywrightTokenPayload {
  const [payloadB64, signature] = token.split('.');

  if (!payloadB64 || !signature) {
    throw new Error('Invalid token format');
  }

  const expectedSignature = sign(payloadB64);
  const provided = Buffer.from(signature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(
    base64UrlDecode(payloadB64).toString('utf8')
  ) as PlaywrightTokenPayload;

  if (!payload.userId || !payload.expiresAt || !payload.issuedAt) {
    throw new Error('Invalid token payload');
  }

  if (Date.now() > payload.expiresAt) {
    throw new Error('Token expired');
  }

  return payload;
}
