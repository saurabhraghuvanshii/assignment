import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encryptString } from '@/lib/crypto';

type UberTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const url = new URL(req.url);
  const appOrigin = url.origin;
  if (!userId) return NextResponse.redirect(new URL('/?oauth=uber-unauthenticated', appOrigin));

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  if (err) return NextResponse.redirect(new URL(`/?oauth=uber-denied&reason=${encodeURIComponent(err)}`, appOrigin));
  if (!code || !state) return NextResponse.redirect(new URL('/?oauth=uber-missing-code', appOrigin));

  const expectedState = req.headers.get('cookie')?.match(/(?:^|;\s*)uber_oauth_state=([^;]+)/)?.[1];
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(new URL('/?oauth=uber-state-mismatch', appOrigin));
  }

  const clientId = process.env.UBER_CLIENT_ID;
  const clientSecret = process.env.UBER_CLIENT_SECRET;
  const redirectUri = process.env.UBER_REDIRECT_URI;
  const authBase = (process.env.UBER_AUTH_BASE || 'https://login.uber.com').replace(/\/$/, '');
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(new URL('/?oauth=uber-missing-config', appOrigin));
  }

  try {
    const tokenRes = await fetch(`${authBase}/oauth/v2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL(`/?oauth=uber-token-failed&code=${tokenRes.status}`, appOrigin));
    }

    const token = (await tokenRes.json()) as UberTokenResponse;
    if (!token.access_token) {
      return NextResponse.redirect(new URL('/?oauth=uber-token-missing', appOrigin));
    }

    const payload = JSON.stringify({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      tokenType: token.token_type,
      scope: token.scope,
    });

    await prisma.integration.upsert({
      where: { userId_provider: { userId, provider: 'uber' } },
      update: {
        provider: 'uber',
        status: 'connected',
        scopes: ['read:ride_history', 'read:profile_basic', 'oauth'],
        sessionEncrypted: encryptString(payload),
        sessionLast4: token.access_token.slice(-4),
        lastSyncStatus: 'connected via OAuth',
        metadata: {
          oauth: true,
          tokenType: token.token_type ?? 'Bearer',
          expiresIn: token.expires_in ?? null,
        },
      },
      create: {
        userId,
        provider: 'uber',
        status: 'connected',
        scopes: ['read:ride_history', 'read:profile_basic', 'oauth'],
        sessionEncrypted: encryptString(payload),
        sessionLast4: token.access_token.slice(-4),
        lastSyncStatus: 'connected via OAuth',
        metadata: {
          oauth: true,
          tokenType: token.token_type ?? 'Bearer',
          expiresIn: token.expires_in ?? null,
        },
      },
    });

    const res = NextResponse.redirect(new URL('/?oauth=uber-connected', appOrigin));
    res.cookies.set('uber_oauth_state', '', { path: '/', maxAge: 0 });
    return res;
  } catch {
    return NextResponse.redirect(new URL('/?oauth=uber-callback-error', appOrigin));
  }
}

