import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { encryptString } from '@/lib/crypto';
import { maskSecret, type ZomatoAuthCookies } from '@/lib/scrapers/zomato-user-scraper';

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const body = (await req.json()) as Partial<ZomatoAuthCookies>;
    const cid = String(body.cid ?? '').trim();
    const PHPSESSID = String(body.PHPSESSID ?? '').trim();
    const zat = String(body.zat ?? '').trim();

    if (!cid || !PHPSESSID || !zat) {
      return NextResponse.json(
        { error: 'Missing cookies. Required: cid, PHPSESSID, zat' },
        { status: 400 }
      );
    }

    const payload = JSON.stringify({ cid, PHPSESSID, zat });
    const sessionEncrypted = encryptString(payload);

    const scopes = [
      'read:order_history',
      'read:profile_basic',
    ];

    await prisma.integration.upsert({
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

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Zomato connect error:', e);
    return NextResponse.json({ error: 'Failed to connect Zomato' }, { status: 500 });
  }
}

