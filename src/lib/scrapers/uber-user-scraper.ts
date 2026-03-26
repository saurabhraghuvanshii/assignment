/**
 * Uber user history scraper (authenticated, best-effort).
 *
 * Uber internal endpoints vary by region/account. We support:
 * 1) user-provided history API URL
 * 2) fallback list of common endpoints
 *
 * Auth expected:
 * - Full cookie header from logged-in uber.com/riders.uber.com
 * - Optional csrf token header
 */

export type UberSessionInput = {
  cookieHeader: string;
  csrfToken?: string;
  historyUrl?: string;
  demoMode?: boolean;
  accessToken?: string;
};

export type UberTrip = {
  tripId: string;
  startAddress: string;
  endAddress: string;
  startTime: Date;
  endTime: Date;
  fare: number;
  distanceKm: number;
  rideType: string;
};

const TIMEOUT_MS = 15_000;

const COMMON_HISTORY_ENDPOINTS = [
  'https://riders.uber.com/api/getTripsForClient?limit=50',
  'https://riders.uber.com/api/getTripsForClient',
  'https://www.uber.com/api/getTripsForClient',
  'https://riders.uber.com/api/trips',
];

export function maskCookieHeader(cookieHeader: string): string {
  const tail = cookieHeader.slice(-6);
  return tail ? `...${tail}` : '';
}

export async function fetchUberTrips(session: UberSessionInput): Promise<UberTrip[]> {
  if (session.demoMode || session.cookieHeader.includes('TEST_UBER_DEMO')) {
    return buildDemoTrips();
  }

  if (session.accessToken) {
    const apiBase = process.env.UBER_API_BASE?.trim() || 'https://api.uber.com';
    const tripsPath = process.env.UBER_TRIPS_ENDPOINT?.trim() || '/v1.2/history';
    const url = `${apiBase.replace(/\/$/, '')}${tripsPath.startsWith('/') ? tripsPath : `/${tripsPath}`}`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OAuth history endpoint returned HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    const trips = parseTrips(json);
    if (trips.length > 0) return trips;
    throw new Error('OAuth history endpoint returned no trips');
  }

  const endpoints = [
    ...(session.historyUrl ? [session.historyUrl] : []),
    ...COMMON_HISTORY_ENDPOINTS,
  ];

  let lastError = 'No endpoint succeeded';
  for (const url of endpoints) {
    try {
      const trips = await fetchTripsFromEndpoint(url, session);
      if (trips.length > 0) return trips;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  throw new Error(`Uber history fetch failed: ${lastError}`);
}

async function fetchTripsFromEndpoint(url: string, session: UberSessionInput): Promise<UberTrip[]> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      cookie: session.cookieHeader,
      referer: 'https://riders.uber.com/trips',
      origin: 'https://riders.uber.com',
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ...(session.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const json = (await res.json()) as Record<string, unknown>;
  return parseTrips(json);
}

function parseTrips(data: Record<string, unknown>): UberTrip[] {
  // Try a few common shapes
  const candidates: unknown[] = [];

  const arr1 = data.trips;
  if (Array.isArray(arr1)) candidates.push(...arr1);

  const arr2 = data.data;
  if (Array.isArray(arr2)) candidates.push(...arr2);

  const objData = data.data as Record<string, unknown> | undefined;
  if (objData) {
    if (Array.isArray(objData.trips)) candidates.push(...objData.trips);
    if (Array.isArray(objData.history)) candidates.push(...objData.history);
    if (Array.isArray(objData.items)) candidates.push(...objData.items);
  }

  const out: UberTrip[] = [];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const tripId = String(t.tripId ?? t.uuid ?? t.id ?? '').trim();
    if (!tripId) continue;

    const startAddress = String(
      t.startAddress ??
        (t.startLocation as Record<string, unknown> | undefined)?.address ??
        (t.beginTrip as Record<string, unknown> | undefined)?.address ??
        'Unknown origin'
    );
    const endAddress = String(
      t.endAddress ??
        (t.endLocation as Record<string, unknown> | undefined)?.address ??
        (t.dropoff as Record<string, unknown> | undefined)?.address ??
        'Unknown destination'
    );

    const startTime = parseDate(
      t.startTime ??
        t.requestTime ??
        (t.beginTrip as Record<string, unknown> | undefined)?.time ??
        new Date().toISOString()
    );
    const endTime = parseDate(
      t.endTime ??
        t.completedTime ??
        (t.endTrip as Record<string, unknown> | undefined)?.time ??
        new Date(startTime.getTime() + 30 * 60_000).toISOString()
    );

    const fare = normalizeMoney(
      t.fare ??
        (t.payment as Record<string, unknown> | undefined)?.total ??
        (t.receipt as Record<string, unknown> | undefined)?.total ??
        0
    );

    const distanceKm = normalizeDistance(
      t.distance ??
        (t.route as Record<string, unknown> | undefined)?.distance ??
        5
    );

    const rideType = String(
      t.rideType ??
        t.productName ??
        (t.product as Record<string, unknown> | undefined)?.displayName ??
        'cab'
    ).toLowerCase();

    out.push({
      tripId,
      startAddress,
      endAddress,
      startTime,
      endTime,
      fare,
      distanceKm,
      rideType,
    });
  }

  return dedupe(out);
}

function buildDemoTrips(): UberTrip[] {
  const now = new Date();
  const mk = (
    id: string,
    daysAgo: number,
    startAddress: string,
    endAddress: string,
    fare: number,
    distanceKm: number,
    rideType: string
  ): UberTrip => {
    const start = new Date(now.getTime() - daysAgo * 24 * 60 * 60_000);
    start.setHours(9 + (daysAgo % 8), 15, 0, 0);
    const end = new Date(start.getTime() + 35 * 60_000);
    return {
      tripId: id,
      startAddress,
      endAddress,
      startTime: start,
      endTime: end,
      fare,
      distanceKm,
      rideType,
    };
  };

  return [
    mk('demo-trip-1', 1, 'Home', 'Office', 230, 8.2, 'cab'),
    mk('demo-trip-2', 2, 'Office', 'Gym', 140, 4.1, 'auto'),
    mk('demo-trip-3', 3, 'Gym', 'Home', 190, 6.5, 'cab'),
    mk('demo-trip-4', 5, 'Home', 'Airport', 620, 28.4, 'premium'),
    mk('demo-trip-5', 7, 'Office', 'Home', 245, 8.6, 'cab'),
  ];
}

function parseDate(v: unknown): Date {
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms);
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function normalizeMoney(v: unknown): number {
  if (typeof v === 'number') return Math.round(v);
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? 0 : Math.round(n);
}

function normalizeDistance(v: unknown): number {
  if (typeof v === 'number') return v > 100 ? Number((v / 1000).toFixed(1)) : v;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function dedupe(trips: UberTrip[]): UberTrip[] {
  const seen = new Set<string>();
  const out: UberTrip[] = [];
  for (const t of trips) {
    if (seen.has(t.tripId)) continue;
    seen.add(t.tripId);
    out.push(t);
  }
  return out.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
}

