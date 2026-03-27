import { NextResponse } from "next/server";
import {
  saveRapidoSession,
  validateRapidoSessionInput,
  type RapidoSessionPayload,
} from "@/lib/integrations/rapido-session";
import { verifyRapidoPlaywrightToken } from "@/lib/integrations/rapido-playwright-token";

export const dynamic = "force-dynamic";

type CompletePayload = Partial<RapidoSessionPayload> & {
  token?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CompletePayload;
    const token = String(body.token ?? "").trim();

    if (!token) {
      return NextResponse.json(
        { error: "Missing Playwright completion token" },
        { status: 400 },
      );
    }

    const { userId } = verifyRapidoPlaywrightToken(token);
    const session = validateRapidoSessionInput(body);

    await saveRapidoSession(userId, session);

    return NextResponse.json({
      success: true,
      provider: "rapido",
      message: "Rapido connected from browser session",
    });
  } catch (error) {
    console.error("Rapido Playwright completion error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Failed to complete Rapido browser session capture";

    const status =
      message.startsWith("Missing") ||
      message.includes("Invalid token") ||
      message.includes("Token expired")
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
