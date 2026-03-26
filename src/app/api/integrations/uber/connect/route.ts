import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { encryptString } from '@/lib/crypto';
import { maskCookieHeader } from '@/lib/scrapers/uber-user-scraper';

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const body = (await req.json()) as {
      cookieHeader?: string;
      csrfToken?: string;
      historyUrl?: string;
    };

    const cookieHeader = String(body.cookieHeader ?? '').trim();
    const csrfToken = String(body.csrfToken ?? '').trim();
    const historyUrl = String(body.historyUrl ?? '').trim();

    if (!cookieHeader) {
      return NextResponse.json(
        { error: 'Missing cookieHeader from Uber session' },
        { status: 400 }
      );
    }

    const payload = JSON.stringify({ cookieHeader, csrfToken, historyUrl });
    const sessionEncrypted = encryptString(payload);

    await prisma.integration.upsert({
      where: { userId_provider: { userId, provider: 'uber' } },
      update: {
        status: 'connected',
        scopes: ['read:ride_history', 'read:profile_basic'],
        sessionEncrypted,
        sessionLast4: maskCookieHeader(cookieHeader),
        metadata: historyUrl ? { historyUrl } : undefined,
        lastSyncStatus: 'connected',
      },
      create: {
        userId,
        provider: 'uber',
        status: 'connected',
        scopes: ['read:ride_history', 'read:profile_basic'],
        sessionEncrypted,
        sessionLast4: maskCookieHeader(cookieHeader),
        metadata: historyUrl ? { historyUrl } : undefined,
        lastSyncStatus: 'connected',
      },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Uber connect error:', e);
    return NextResponse.json({ error: 'Failed to connect Uber' }, { status: 500 });
  }
}

