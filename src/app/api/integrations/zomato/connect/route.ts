import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  saveZomatoSession,
  validateZomatoCookies,
} from "@/lib/integrations/zomato-session";
import { type ZomatoAuthCookies } from "@/lib/scrapers/zomato-user-scraper";

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId)
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

    const body = (await req.json()) as Partial<ZomatoAuthCookies>;
    const cookies = validateZomatoCookies(body);

    await saveZomatoSession(userId, cookies);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Zomato connect error:", e);
    const message = e instanceof Error ? e.message : "Failed to connect Zomato";
    const status = message.startsWith("Missing cookies") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
