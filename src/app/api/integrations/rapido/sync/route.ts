import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { decryptString } from "@/lib/crypto";
import {
  fetchRapidoTrips,
  type RapidoSessionInput,
  type RapidoTrip,
} from "@/lib/scrapers/rapido-user-scraper";

type StoredRapidoSession = {
  cookieHeader?: string;
  historyUrl?: string;
  demoMode?: boolean;
  storageState?: string;
  historyEmail?: string;
  fromDate?: string;
  toDate?: string;
};

export async function POST() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: "rapido" } },
  });

  if (!integration?.sessionEncrypted) {
    return NextResponse.json(
      { error: "Rapido not connected" },
      { status: 400 },
    );
  }

  try {
    const sessionJson = decryptString(integration.sessionEncrypted);
    const raw = JSON.parse(sessionJson) as StoredRapidoSession;
    const sessionEmail = (session?.user as { email?: string } | undefined)?.email;

    const sessionInput: RapidoSessionInput = {
      cookieHeader: raw.cookieHeader ?? "",
      historyUrl: raw.historyUrl,
      demoMode: raw.demoMode,
      storageState: raw.storageState,
      historyEmail: raw.historyEmail || sessionEmail,
      fromDate: raw.fromDate,
      toDate: raw.toDate,
    };

    const trips = await fetchRapidoTrips(sessionInput);
    const imported = await importTrips(userId, trips);

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: `ok: imported ${imported} trips`,
        status: "connected",
      },
    });

    return NextResponse.json({
      success: true,
      imported,
      totalFetched: trips.length,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: `error: ${reason}`,
        status: "error",
      },
    });

    return NextResponse.json({ error: "Sync failed", reason }, { status: 500 });
  }
}

async function importTrips(
  userId: string,
  trips: RapidoTrip[],
): Promise<number> {
  let imported = 0;

  for (const trip of trips) {
    const existing = await prisma.rideHistory.findFirst({
      where: {
        userId,
        platform: "rapido",
        departureTime: trip.startTime,
        destAddress: trip.endAddress,
        cost: trip.fare,
      },
      select: { id: true },
    });

    if (existing) continue;

    await prisma.rideHistory.create({
      data: {
        userId,
        platform: "rapido",
        rideType: mapRideType(trip.rideType),
        originAddress: trip.startAddress || "Unknown origin",
        originLat: 0,
        originLng: 0,
        destAddress: trip.endAddress || "Unknown destination",
        destLat: 0,
        destLng: 0,
        departureTime: trip.startTime,
        arrivalTime: trip.endTime,
        cost: trip.fare,
        distance: trip.distanceKm || 0,
        dayOfWeek: trip.startTime.getDay(),
      },
    });

    imported++;
  }

  return imported;
}

function mapRideType(value: string): string {
  const s = value.toLowerCase();

  if (s.includes("bike")) return "bike";
  if (s.includes("auto")) return "auto";
  if (s.includes("cab") || s.includes("car") || s.includes("taxi"))
    return "cab";
  if (s.includes("premium")) return "premium";

  return "bike";
}
