import { prisma } from '@/lib/prisma';
import { encryptString } from '@/lib/crypto';
import { maskSecret, type ZomatoAuthCookies } from '@/lib/scrapers/zomato-user-scraper';

export async function saveZomatoSession(userId: string, cookies: ZomatoAuthCookies) {
  const cid = String(cookies.cid ?? '').trim();
  const PHPSESSID = String(cookies.PHPSESSID ?? '').trim();
  const zat = String(cookies.zat ?? '').trim();
  const user_city_ids = String((cookies as { user_city_ids?: string }).user_city_ids ?? '').trim();

  if (!cid || !PHPSESSID || !zat) {
    throw new Error('Missing cookies. Required: cid, PHPSESSID, zat');
  }

  const payload = JSON.stringify({ cid, PHPSESSID, zat, user_city_ids: user_city_ids || undefined });
  const sessionEncrypted = encryptString(payload);

  const scopes = ['read:order_history', 'read:profile_basic'];

  return prisma.integration.upsert({
    where: { userId_provider: { userId, provider: 'zomato' } },
    update: {
      status: 'connected',
      scopes,
      sessionEncrypted,
      sessionLast4: maskSecret(zat),
      lastSyncStatus: 'connected',
    },
    create: {
      userId,
      provider: 'zomato',
      status: 'connected',
      scopes,
      sessionEncrypted,
      sessionLast4: maskSecret(zat),
      lastSyncStatus: 'connected',
    },
  });
}

export function validateZomatoCookies(input: Partial<ZomatoAuthCookies>): ZomatoAuthCookies {
  const cookies: ZomatoAuthCookies = {
    cid: String(input.cid ?? '').trim(),
    PHPSESSID: String(input.PHPSESSID ?? '').trim(),
    zat: String(input.zat ?? '').trim(),
    user_city_ids: String((input as { user_city_ids?: string }).user_city_ids ?? '').trim(),
  };

  if (!cookies.cid || !cookies.PHPSESSID || !cookies.zat) {
    throw new Error('Missing cookies. Required: cid, PHPSESSID, zat');
  }

  return cookies;
}
