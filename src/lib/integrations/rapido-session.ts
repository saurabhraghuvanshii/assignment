import { prisma } from "@/lib/prisma";
import { encryptString } from "@/lib/crypto";
import { maskRapidoCookieHeader } from "@/lib/scrapers/rapido-user-scraper";

export type RapidoSessionPayload = {
  cookieHeader?: string;
  historyUrl?: string;
  storageState?: string;
  historyEmail?: string;
  fromDate?: string;
  toDate?: string;
};

export function validateRapidoSessionInput(
  input: Partial<RapidoSessionPayload>,
): RapidoSessionPayload {
  const cookieHeader = String(input.cookieHeader ?? "").trim();
  const historyUrl = String(
    input.historyUrl ?? "https://m.rapido.bike/my-rides",
  ).trim();
  const storageState = String(input.storageState ?? "").trim();
  const historyEmail = String(input.historyEmail ?? "").trim();
  const fromDate = String(input.fromDate ?? "").trim();
  const toDate = String(input.toDate ?? "").trim();

  if (!cookieHeader && !storageState) {
    throw new Error("Missing Rapido session data");
  }

  return {
    ...(cookieHeader ? { cookieHeader } : {}),
    historyUrl: historyUrl || "https://m.rapido.bike/my-rides",
    ...(storageState ? { storageState } : {}),
    ...(historyEmail ? { historyEmail } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
  };
}

export async function saveRapidoSession(
  userId: string,
  session: RapidoSessionPayload,
) {
  const validated = validateRapidoSessionInput(session);
  const payload = JSON.stringify(validated);
  const sessionEncrypted = encryptString(payload);

  const scopes = ["read:ride_history", "read:profile_basic"];

  return prisma.integration.upsert({
    where: { userId_provider: { userId, provider: "rapido" } },
    update: {
      status: "connected",
      scopes,
      sessionEncrypted,
      sessionLast4: validated.cookieHeader
        ? maskRapidoCookieHeader(validated.cookieHeader)
        : "state",
      metadata: {
        historyUrl: validated.historyUrl,
        historyEmail: validated.historyEmail ?? null,
        fromDate: validated.fromDate ?? null,
        toDate: validated.toDate ?? null,
      },
      lastSyncStatus: "connected",
    },
    create: {
      userId,
      provider: "rapido",
      status: "connected",
      scopes,
      sessionEncrypted,
      sessionLast4: validated.cookieHeader
        ? maskRapidoCookieHeader(validated.cookieHeader)
        : "state",
      metadata: {
        historyUrl: validated.historyUrl,
        historyEmail: validated.historyEmail ?? null,
        fromDate: validated.fromDate ?? null,
        toDate: validated.toDate ?? null,
      },
      lastSyncStatus: "connected",
    },
  });
}
