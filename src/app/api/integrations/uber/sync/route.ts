import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { decryptString } from '@/lib/crypto';
import { fetchUberTrips, type UberSessionInput, type UberTrip } from '@/lib/scrapers/uber-user-scraper';

export async function POST() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'uber' } },
  });
  if (!integration?.sessionEncrypted) {
    return NextResponse.json({ error: 'Uber not connected' }, { status: 400 });
  }

  try {
    const sessionJson = decryptString(integration.sessionEncrypted);
    const raw = JSON.parse(sessionJson) as {
      cookieHeader?: string;
      csrfToken?: string;
      historyUrl?: string;
      accessToken?: string;
      demoMode?: boolean;
    };
    const sessionInput: UberSessionInput = {
      cookieHeader: raw.cookieHeader ?? '',
      csrfToken: raw.csrfToken,
      historyUrl: raw.historyUrl,
      accessToken: raw.accessToken,
      demoMode: raw.demoMode,
    };
    const trips = await fetchUberTrips(sessionInput);
    const imported = await importTrips(userId, trips);

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: `ok: imported ${imported} trips`,
        status: 'connected',
      },
    });

    return NextResponse.json({ success: true, imported, totalFetched: trips.length });
  } catch (e) {
    const reason = (e as Error).message || 'unknown error';
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: `error: ${reason}`,
        status: 'error',
      },
    });
    return NextResponse.json({ error: 'Sync failed', reason }, { status: 500 });
  }
}

async function importTrips(userId: string, trips: UberTrip[]): Promise<number> {
  let imported = 0;

  for (const t of trips) {
    const existing = await prisma.rideHistory.findFirst({
      where: {
        userId,
        platform: 'uber',
        departureTime: t.startTime,
        destAddress: t.endAddress,
        cost: t.fare,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.rideHistory.create({
      data: {
        userId,
        platform: 'uber',
        rideType: mapRideType(t.rideType),
        originAddress: t.startAddress || 'Unknown origin',
        originLat: 0,
        originLng: 0,
        destAddress: t.endAddress || 'Unknown destination',
        destLat: 0,
        destLng: 0,
        departureTime: t.startTime,
        arrivalTime: t.endTime,
        cost: t.fare,
        distance: t.distanceKm || 0,
        dayOfWeek: t.startTime.getDay(),
      },
    });
    imported++;
  }

  return imported;
}

function mapRideType(v: string): string {
  const s = v.toLowerCase();
  if (s.includes('bike') || s.includes('moto')) return 'bike';
  if (s.includes('auto') || s.includes('rick')) return 'auto';
  if (s.includes('premier') || s.includes('black') || s.includes('xl')) return 'premium';
  return 'cab';
}

