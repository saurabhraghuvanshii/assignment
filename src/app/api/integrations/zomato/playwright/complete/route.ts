import { NextResponse } from 'next/server';
import { saveZomatoSession, validateZomatoCookies } from '@/lib/integrations/zomato-session';
import { verifyZomatoPlaywrightToken } from '@/lib/integrations/zomato-playwright-token';
import { type ZomatoAuthCookies } from '@/lib/scrapers/zomato-user-scraper';

export const dynamic = 'force-dynamic';

type CompletePayload = Partial<ZomatoAuthCookies> & {
  token?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CompletePayload;
    const token = String(body.token ?? '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Missing Playwright completion token' }, { status: 400 });
    }

    const { userId } = verifyZomatoPlaywrightToken(token);
    const cookies = validateZomatoCookies(body);

    await saveZomatoSession(userId, cookies);

    return NextResponse.json({
      success: true,
      provider: 'zomato',
      message: 'Zomato connected from browser session',
    });
  } catch (error) {
    console.error('Zomato Playwright completion error:', error);

    const message =
      error instanceof Error ? error.message : 'Failed to complete Zomato browser session capture';

    const status =
      message.startsWith('Missing') ||
      message.includes('Invalid token') ||
      message.includes('Token expired')
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
