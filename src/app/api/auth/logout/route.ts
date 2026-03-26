import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function POST(req: Request) {
  // With NextAuth JWT sessions, the correct logout flow is handled by NextAuth.
  // We redirect the browser to NextAuth's signout endpoint.
  // (The client currently does not depend on the JSON response body.)
  const session = await auth();
  if (session) {
    const origin = new URL(req.url).origin;
    return NextResponse.redirect(new URL(`/api/auth/signout?callbackUrl=/`, origin));
  }
  return NextResponse.json({ success: true });
}

