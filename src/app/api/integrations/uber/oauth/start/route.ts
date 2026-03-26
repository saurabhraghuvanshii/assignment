import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.redirect(new URL('/', req.url));

  const clientId = process.env.UBER_CLIENT_ID;
  const redirectUri = process.env.UBER_REDIRECT_URI;
  const authBase = (process.env.UBER_AUTH_BASE || 'https://login.uber.com').replace(/\/$/, '');
  const oauthScope = process.env.UBER_OAUTH_SCOPE || 'profile history';
  if (!clientId || !redirectUri) {
    return NextResponse.redirect(new URL('/?oauth=uber-missing-config', req.url));
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authorizeUrl = new URL(`${authBase}/oauth/v2/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', oauthScope);
  authorizeUrl.searchParams.set('state', state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set('uber_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  });
  return res;
}

