import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";

type PlaywrightBrowserModule = typeof import("playwright");

export type RapidoSessionInput = {
  cookieHeader: string;
  historyUrl?: string;
  demoMode?: boolean;
  storageState?: string;
};

export type RapidoTrip = {
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
const DEFAULT_HISTORY_URL = "https://m.rapido.bike/my-rides";
const DEBUG_DIR = path.join(process.cwd(), ".logs");

export function maskRapidoCookieHeader(cookieHeader: string): string {
  const tail = cookieHeader.slice(-6);
  return tail ? `...${tail}` : "";
}

export async function fetchRapidoTrips(
  session: RapidoSessionInput,
): Promise<RapidoTrip[]> {
  if (session.demoMode || session.cookieHeader.includes("TEST_RAPIDO_DEMO")) {
    return buildDemoTrips();
  }

  const hasCookieHeader = Boolean(session.cookieHeader.trim());
  const hasStorageState = Boolean(session.storageState?.trim());

  if (!hasCookieHeader && !hasStorageState) {
    throw new Error("Missing Rapido session data");
  }

  const url = session.historyUrl?.trim() || DEFAULT_HISTORY_URL;

  if (hasCookieHeader) {
    const html = await fetchRapidoHistoryHtml(url, session.cookieHeader);
    const trips = parseRapidoTripsFromHtml(html);

    if (trips.length > 0) {
      return dedupe(trips);
    }
  }

  const renderedTrips = await fetchRapidoTripsFromRenderedPage(
    url,
    session.cookieHeader,
    session.storageState,
  );

  if (renderedTrips.length === 0) {
    throw new Error("Rapido history page returned no parsable trips");
  }

  return dedupe(renderedTrips);
}

async function fetchRapidoHistoryHtml(
  url: string,
  cookieHeader: string,
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      cookie: cookieHeader,
      referer: "https://m.rapido.bike/",
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Rapido history HTTP ${res.status}: ${text.slice(0, 180)}`);
  }

  return text;
}

export function parseRapidoTripsFromHtml(html: string): RapidoTrip[] {
  const trips: RapidoTrip[] = [];

  trips.push(...parseFromEmbeddedJson(html));
  if (trips.length > 0) return dedupe(trips);

  trips.push(...parseFromDom(html));
  return dedupe(trips);
}

async function fetchRapidoTripsFromRenderedPage(
  url: string,
  cookieHeader: string,
  storageState?: string,
): Promise<RapidoTrip[]> {
  let browserModule: PlaywrightBrowserModule | null = null;

  try {
    browserModule = (await import("playwright")) as PlaywrightBrowserModule;
  } catch {
    return [];
  }

  const browser = await browserModule.chromium.launch({
    headless: true,
  });

  try {
    const parsedStorageState = parseStorageState(storageState);

    const context = await browser.newContext({
      viewport: { width: 430, height: 900 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ...(parsedStorageState
        ? { storageState: parsedStorageState as never }
        : {}),
    });

    if (!parsedStorageState) {
      const cookies = parseCookieHeaderToPlaywrightCookies(cookieHeader, url);
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }
    }

    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await ensureRenderedHistoryLoaded(page, url);
    await tryFillRapidoOneYearDateRange(page);

    const html = await page.content();
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const currentUrl = page.url();

    if (looksLikeRapidoAuthScreen(text, currentUrl)) {
      await writeRapidoDebugDump("rapido-auth-screen", html, text, currentUrl);
      throw new Error(
        "Rapido session is still on the phone verification screen. Reconnect Rapido and make sure the browser reaches the real my-rides page before sync.",
      );
    }

    const trips = parseRapidoTripsFromHtml(html);

    if (trips.length > 0) {
      return trips;
    }

    const textTrips = parseRapidoTripsFromText(text);
    if (textTrips.length > 0) {
      return textTrips;
    }

    await writeRapidoDebugDump("rapido-no-trips", html, text, currentUrl);
    return [];
  } finally {
    await browser.close();
  }
}

function looksLikeRapidoAuthScreen(text: string, currentUrl?: string): boolean {
  const lower = String(text || "").toLowerCase();
  const lowerUrl = String(currentUrl || "").toLowerCase();

  return (
    lower.includes("confirm your number") ||
    lower.includes("get an sms") ||
    lower.includes("verify otp") ||
    lower.includes("enter otp") ||
    lower.includes("sign in") ||
    lower.includes("login") ||
    lowerUrl.includes("/login") ||
    lowerUrl.includes("/otp")
  );
}

async function writeRapidoDebugDump(
  prefix: string,
  html: string,
  text: string,
  currentUrl: string,
): Promise<void> {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const basePath = path.join(DEBUG_DIR, `${prefix}-${stamp}`);

    fs.writeFileSync(
      `${basePath}.html`,
      `<!-- URL: ${currentUrl} -->\n${html}`,
      "utf8",
    );
    fs.writeFileSync(
      `${basePath}.txt`,
      `URL: ${currentUrl}\n\n${text}`,
      "utf8",
    );
  } catch {
    // ignore debug dump failures
  }
}

function parseStorageState(storageState?: string):
  | {
      cookies?: Array<{
        name: string;
        value: string;
        domain?: string;
        path?: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
      }>;
      origins?: Array<{
        origin: string;
        localStorage?: Array<{ name: string; value: string }>;
      }>;
    }
  | undefined {
  if (!storageState?.trim()) return undefined;

  try {
    return JSON.parse(storageState) as {
      cookies?: Array<{
        name: string;
        value: string;
        domain?: string;
        path?: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: "Strict" | "Lax" | "None";
      }>;
      origins?: Array<{
        origin: string;
        localStorage?: Array<{ name: string; value: string }>;
      }>;
    };
  } catch {
    return undefined;
  }
}

function parseCookieHeaderToPlaywrightCookies(
  cookieHeader: string,
  url: string,
): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
}> {
  const hostname = new URL(url).hostname;

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) return null;

      const name = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();

      if (!name) return null;

      return {
        name,
        value,
        domain: hostname,
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: "Lax" as const,
      };
    })
    .filter(
      (
        cookie,
      ): cookie is {
        name: string;
        value: string;
        domain: string;
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: "Lax";
      } => Boolean(cookie),
    );
}

type RapidoPageLike = {
  goto: (
    url: string,
    options?: {
      waitUntil?: "networkidle" | "domcontentloaded";
      timeout?: number;
    },
  ) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
  url: () => string;
  content: () => Promise<string>;
  evaluate: <T>(pageFunction: () => T | Promise<T>) => Promise<T>;
  locator: (selector: string) => {
    innerText: () => Promise<string>;
    click: (options?: { timeout?: number }) => Promise<void>;
    count: () => Promise<number>;
    nth: (index: number) => {
      click: (options?: { timeout?: number }) => Promise<void>;
      getAttribute: (name: string) => Promise<string | null>;
      fill: (value: string) => Promise<void>;
      press: (key: string) => Promise<void>;
    };
  };
};

async function ensureRenderedHistoryLoaded(
  page: RapidoPageLike,
  url: string,
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.waitForTimeout(1800);

    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");

    if (looksLikeRapidoRideHistory(text)) {
      return;
    }

    const loadMoreSelectors = [
      "text=Load more",
      "text=Show more",
      "text=See more",
      "text=View more",
      "text=More rides",
    ];

    for (const selector of loadMoreSelectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        await locator
          .nth(0)
          .click({ timeout: 1500 })
          .catch(() => undefined);
        await page.waitForTimeout(1500);
      }
    }

    await page
      .evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      })
      .catch(() => undefined);

    await page.waitForTimeout(1200);

    if (attempt === 2) {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
    }
  }
}

function looksLikeRapidoRideHistory(text: string): boolean {
  const lower = String(text || "").toLowerCase();

  if (looksLikeRapidoAuthScreen(lower)) return false;

  return (
    lower.includes("my rides") ||
    lower.includes("rapido") ||
    lower.includes("bike") ||
    lower.includes("auto") ||
    lower.includes("cab") ||
    lower.includes("₹")
  );
}

async function tryFillRapidoOneYearDateRange(
  page: RapidoPageLike,
): Promise<void> {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);

  const fromIso = formatRapidoInputDate(oneYearAgo);
  const toIso = formatRapidoInputDate(now);
  const fromDisplay = formatRapidoDisplayDate(oneYearAgo);
  const toDisplay = formatRapidoDisplayDate(now);

  const candidateInputSelectors = [
    'input[type="date"]',
    'input[placeholder*="From"]',
    'input[placeholder*="from"]',
    'input[placeholder*="To"]',
    'input[placeholder*="to"]',
    'input[name*="from"]',
    'input[name*="From"]',
    'input[name*="to"]',
    'input[name*="To"]',
  ];

  let foundAnyInput = false;

  for (const selector of candidateInputSelectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    foundAnyInput = true;

    for (let i = 0; i < count; i++) {
      const input = locator.nth(i);
      const attrType = await input.getAttribute("type").catch(() => null);
      const attrName =
        (await input.getAttribute("name").catch(() => null)) || "";
      const attrPlaceholder =
        (await input.getAttribute("placeholder").catch(() => null)) || "";
      const attrAria =
        (await input.getAttribute("aria-label").catch(() => null)) || "";
      const labelHint =
        `${attrName} ${attrPlaceholder} ${attrAria}`.toLowerCase();

      const isTo = labelHint.includes("to");

      const preferredValue =
        attrType === "date"
          ? isTo
            ? toIso
            : fromIso
          : isTo
            ? toDisplay
            : fromDisplay;

      await input.click({ timeout: 1000 }).catch(() => undefined);
      await input.fill(preferredValue).catch(() => undefined);
      await input.press("Tab").catch(() => undefined);
    }
  }

  if (!foundAnyInput) {
    const dateTexts = [
      "text=From Date",
      "text=From",
      "text=To Date",
      "text=To",
      "text=Fetch",
      "text=Apply",
      "text=Search",
      "text=Submit",
      "text=Get rides",
    ];

    for (const selector of dateTexts) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        await locator
          .nth(0)
          .click({ timeout: 1200 })
          .catch(() => undefined);
        await page.waitForTimeout(500);
      }
    }

    for (const selector of candidateInputSelectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      if (count === 0) continue;

      foundAnyInput = true;

      for (let i = 0; i < count; i++) {
        const input = locator.nth(i);
        const attrType = await input.getAttribute("type").catch(() => null);
        const attrName =
          (await input.getAttribute("name").catch(() => null)) || "";
        const attrPlaceholder =
          (await input.getAttribute("placeholder").catch(() => null)) || "";
        const attrAria =
          (await input.getAttribute("aria-label").catch(() => null)) || "";
        const labelHint =
          `${attrName} ${attrPlaceholder} ${attrAria}`.toLowerCase();

        const isTo = labelHint.includes("to");
        const preferredValue =
          attrType === "date"
            ? isTo
              ? toIso
              : fromIso
            : isTo
              ? toDisplay
              : fromDisplay;

        await input.click({ timeout: 1000 }).catch(() => undefined);
        await input.fill(preferredValue).catch(() => undefined);
        await input.press("Tab").catch(() => undefined);
      }
    }
  }

  if (!foundAnyInput) return;

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    "text=Fetch",
    "text=Apply",
    "text=Search",
    "text=Submit",
    "text=Get rides",
    "text=Show rides",
  ];

  for (const selector of submitSelectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    await locator
      .nth(0)
      .click({ timeout: 1500 })
      .catch(() => undefined);
    await page.waitForTimeout(2500);
    break;
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    await page
      .evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      })
      .catch(() => undefined);
    await page.waitForTimeout(1500);
  }
}

function formatRapidoInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRapidoDisplayDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function parseRapidoTripsFromText(text: string): RapidoTrip[] {
  const normalized = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isRapidoNoiseLine(line));

  const out: RapidoTrip[] = [];

  for (let index = 0; index < normalized.length; index++) {
    const line = normalized[index];
    if (!looksLikeDateLine(line)) continue;

    const block = normalized.slice(
      Math.max(0, index - 6),
      Math.min(normalized.length, index + 8),
    );
    const combined = block.join(" ").trim();

    const route =
      extractRouteFromText(combined) || extractRouteFromLines(block);
    if (!route) continue;

    const fare = extractFareFromText(combined);
    const distanceKm = extractDistanceFromText(combined);
    const rideType = extractRideTypeFromText(combined);
    const date = extractDateFromText(combined);

    out.push({
      tripId: `rapido-text-${index}-${simpleHash(combined)}`,
      startAddress: route.startAddress,
      endAddress: route.endAddress,
      startTime: date,
      endTime: new Date(date.getTime() + 25 * 60_000),
      fare,
      distanceKm,
      rideType,
    });
  }

  return dedupe(out);
}

function extractRouteFromLines(
  lines: string[],
): { startAddress: string; endAddress: string } | null {
  const candidates = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isRapidoMetadataLine(line));

  if (candidates.length < 2) return null;

  for (let i = 0; i < candidates.length - 1; i++) {
    const startAddress = cleanAddress(candidates[i]);
    const endAddress = cleanAddress(candidates[i + 1]);

    if (
      startAddress &&
      endAddress &&
      startAddress.toLowerCase() !== endAddress.toLowerCase()
    ) {
      return { startAddress, endAddress };
    }
  }

  return null;
}

function isRapidoNoiseLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.includes("confirm your number") ||
    lower.includes("get an sms") ||
    lower.includes("verify otp") ||
    lower.includes("enter otp")
  );
}

function isRapidoMetadataLine(line: string): boolean {
  const lower = line.toLowerCase();

  return (
    isRapidoNoiseLine(line) ||
    looksLikeDateLine(line) ||
    /\b\d{1,2}:\d{2}\s*(am|pm)\b/i.test(line) ||
    /(?:₹|rs\.?|inr)\s*\d+/i.test(line) ||
    /\b\d+(?:\.\d+)?\s*(km|kilometres?)\b/i.test(line) ||
    lower === "rapido" ||
    lower === "bike" ||
    lower === "auto" ||
    lower === "cab" ||
    lower === "premium"
  );
}

function looksLikeDateLine(line: string): boolean {
  return (
    /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/.test(line) ||
    /\b[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b/.test(line) ||
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(line)
  );
}

function parseFromEmbeddedJson(html: string): RapidoTrip[] {
  const out: RapidoTrip[] = [];

  const jsonBlobs = extractJsonBlobs(html);
  for (const blob of jsonBlobs) {
    try {
      const parsed = JSON.parse(blob) as unknown;
      out.push(...extractTripsFromUnknown(parsed));
    } catch {
      // ignore invalid JSON blobs
    }
  }

  return out;
}

function extractJsonBlobs(html: string): string[] {
  const blobs: string[] = [];
  const $ = cheerio.load(html);

  $("script").each((_, el) => {
    const text = $(el).html() || $(el).text() || "";
    const trimmed = text.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      blobs.push(trimmed);
      return;
    }

    const nextDataMatch = trimmed.match(
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    );
    if (nextDataMatch?.[1]) blobs.push(nextDataMatch[1]);

    const assignmentPatterns = [
      /__NEXT_DATA__\s*=\s*({[\s\S]*?});?/,
      /__INITIAL_STATE__\s*=\s*({[\s\S]*?});?/,
      /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?/,
      /window\.__NEXT_DATA__\s*=\s*({[\s\S]*?});?/,
      /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});?/,
    ];

    for (const pattern of assignmentPatterns) {
      const match = trimmed.match(pattern);
      if (match?.[1]) blobs.push(match[1]);
    }
  });

  const nextDataDirect = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (nextDataDirect?.[1]) blobs.push(nextDataDirect[1]);

  return blobs;
}

function extractTripsFromUnknown(input: unknown): RapidoTrip[] {
  const out: RapidoTrip[] = [];

  walk(input, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;

    const obj = node as Record<string, unknown>;
    const trip = normalizeRapidoTrip(obj);
    if (trip) out.push(trip);

    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!item || typeof item !== "object" || Array.isArray(item))
            continue;
          const nestedTrip = normalizeRapidoTrip(
            item as Record<string, unknown>,
          );
          if (nestedTrip) out.push(nestedTrip);
        }
      }
    }
  });

  return out;
}

function normalizeRapidoTrip(raw: Record<string, unknown>): RapidoTrip | null {
  const tripId = stringFrom(
    raw.tripId,
    raw.booking_id,
    raw.bookingId,
    raw.rideId,
    raw.ride_id,
    raw.orderId,
    raw.order_id,
    raw.id,
    raw.uuid,
  ).trim();

  const startAddress = stringFrom(
    raw.pickupAddress,
    raw.pickup_address,
    raw.pickupLocation,
    raw.pickup_location,
    raw.source,
    raw.sourceAddress,
    raw.startAddress,
    raw.start_address,
    raw.from,
    raw.origin,
    nestedValue(raw, "pickup", "address"),
    nestedValue(raw, "source", "address"),
    nestedValue(raw, "from", "address"),
  ).trim();

  const endAddress = stringFrom(
    raw.dropAddress,
    raw.drop_address,
    raw.dropLocation,
    raw.drop_location,
    raw.destination,
    raw.destinationAddress,
    raw.endAddress,
    raw.end_address,
    raw.to,
    raw.dest,
    nestedValue(raw, "drop", "address"),
    nestedValue(raw, "destination", "address"),
    nestedValue(raw, "to", "address"),
  ).trim();

  const rideType = stringFrom(
    raw.rideType,
    raw.ride_type,
    raw.serviceType,
    raw.service_type,
    raw.category,
    raw.vehicleType,
    raw.vehicle_type,
    raw.productName,
    "bike",
  ).toLowerCase();

  const fare = normalizeMoney(
    raw.fare,
    raw.amount,
    raw.totalFare,
    raw.total_fare,
    raw.totalAmount,
    raw.total_amount,
    raw.price,
  );

  const distanceKm = normalizeDistance(
    raw.distance,
    raw.distanceKm,
    raw.distance_km,
    raw.tripDistance,
    raw.trip_distance,
  );

  const startTime = parseDate(
    firstDefined(
      raw.startTime,
      raw.startedAt,
      raw.started_at,
      raw.pickupTime,
      raw.pickup_time,
      raw.bookingTime,
      raw.booking_time,
      raw.createdAt,
      raw.created_at,
      raw.date,
    ),
  );

  const endTime = parseDate(
    firstDefined(
      raw.endTime,
      raw.endedAt,
      raw.ended_at,
      raw.dropTime,
      raw.drop_time,
      raw.completedAt,
      raw.completed_at,
      raw.updatedAt,
      raw.updated_at,
      startTime
        ? new Date(startTime.getTime() + 25 * 60_000).toISOString()
        : undefined,
    ),
  );

  const hasTripSignal =
    Boolean(tripId) ||
    (Boolean(startAddress) && Boolean(endAddress)) ||
    fare > 0;

  if (!hasTripSignal) return null;
  if (!startAddress || !endAddress) return null;

  return {
    tripId: tripId || buildSyntheticTripId(startAddress, endAddress, startTime),
    startAddress,
    endAddress,
    startTime,
    endTime,
    fare,
    distanceKm,
    rideType,
  };
}

function parseFromDom(html: string): RapidoTrip[] {
  const $ = cheerio.load(html);
  const out: RapidoTrip[] = [];

  const rapidoOrders = $(".order");

  rapidoOrders.each((index, el) => {
    const card = $(el);

    const amountText = card.find(".amount").first().text().trim();
    const fare = extractFareFromText(amountText);

    const dateTimeTexts = card
      .find(".date-and-time")
      .map((_, node) => $(node).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);

    const dateText =
      dateTimeTexts.find((value) => looksLikeDateLine(value)) || "";
    const timeText =
      dateTimeTexts.find((value) =>
        /\b\d{1,2}:\d{2}\s*(am|pm)\b/i.test(value),
      ) || "";

    const date = parseRapidoDateTime(dateText, timeText);
    const rideId =
      card.find(".unique-id").first().text().replace(/\s+/g, " ").trim() ||
      `rapido-dom-${index}-${simpleHash(card.text())}`;

    const addresses = card
      .find(".clip-address")
      .map((_, node) => $(node).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);

    if (addresses.length < 2) return;

    const route = {
      startAddress: cleanAddress(addresses[0]),
      endAddress: cleanAddress(addresses[1]),
    };

    const rideText = card.text().replace(/\s+/g, " ").trim();
    const rideType = extractRideTypeFromText(rideText);
    const distanceKm = extractDistanceFromText(rideText);

    out.push({
      tripId: rideId,
      startAddress: route.startAddress,
      endAddress: route.endAddress,
      startTime: date,
      endTime: new Date(date.getTime() + 25 * 60_000),
      fare,
      distanceKm,
      rideType,
    });
  });

  if (out.length > 0) {
    return dedupe(out);
  }

  const fallbackCards = $("app-my-rides .order, .my-rides .order");

  fallbackCards.each((index, el) => {
    const cardText = $(el).text().replace(/\s+/g, " ").trim();
    if (!cardText) return;

    const route = extractRouteFromLines(
      $(el)
        .find(".clip-address")
        .map((_, node) => $(node).text().trim())
        .get(),
    );

    if (!route) return;

    const fare = extractFareFromText(cardText);
    const rideType = extractRideTypeFromText(cardText);
    const distanceKm = extractDistanceFromText(cardText);

    const dateText =
      $(el)
        .find(".date-and-time")
        .map((_, node) => $(node).text().replace(/\s+/g, " ").trim())
        .get()
        .find((value) => looksLikeDateLine(value)) || "";
    const timeText =
      $(el)
        .find(".date-and-time")
        .map((_, node) => $(node).text().replace(/\s+/g, " ").trim())
        .get()
        .find((value) => /\b\d{1,2}:\d{2}\s*(am|pm)\b/i.test(value)) || "";

    const date = parseRapidoDateTime(dateText, timeText);

    out.push({
      tripId: `rapido-fallback-${index}-${simpleHash(cardText)}`,
      startAddress: route.startAddress,
      endAddress: route.endAddress,
      startTime: date,
      endTime: new Date(date.getTime() + 25 * 60_000),
      fare,
      distanceKm,
      rideType,
    });
  });

  return dedupe(out);
}

function extractRouteFromText(
  text: string,
): { startAddress: string; endAddress: string } | null {
  const normalized = text.replace(/\s+/g, " ").trim();

  const arrowMatch = normalized.match(
    /([A-Za-z0-9 ,.\-()]{3,}?)\s*(?:→|->|to)\s*([A-Za-z0-9 ,.\-()]{3,})/i,
  );
  if (arrowMatch) {
    return {
      startAddress: cleanAddress(arrowMatch[1]),
      endAddress: cleanAddress(arrowMatch[2]),
    };
  }

  const fromToMatch = normalized.match(
    /from\s+([A-Za-z0-9 ,.\-()]{3,}?)\s+to\s+([A-Za-z0-9 ,.\-()]{3,})/i,
  );
  if (fromToMatch) {
    return {
      startAddress: cleanAddress(fromToMatch[1]),
      endAddress: cleanAddress(fromToMatch[2]),
    };
  }

  return null;
}

function extractFareFromText(text: string): number {
  const fareMatch = text.match(/(?:₹|Rs\.?|INR)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!fareMatch) return 0;
  return Math.round(parseFloat(fareMatch[1]));
}

function extractDistanceFromText(text: string): number {
  const distanceMatch = text.match(
    /([0-9]+(?:\.[0-9]+)?)\s*(?:km|kilometres?)/i,
  );
  if (!distanceMatch) return 0;
  return parseFloat(distanceMatch[1]);
}

function extractRideTypeFromText(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("auto")) return "auto";
  if (lower.includes("cab")) return "cab";
  if (lower.includes("bike")) return "bike";
  return "bike";
}

function extractDateFromText(text: string): Date {
  const datePatterns = [
    /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/,
    /\b[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}\b/,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
    /\b\d{1,2}\s+[A-Za-z]{3}\s+'?\d{2}\b/i,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      const parsed = parseRapidoDateTime(match[0]);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }

  return new Date();
}

function parseRapidoDateTime(dateText: string, timeText?: string): Date {
  const normalizedDate = String(dateText || "")
    .replace(/'/g, "20")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedTime = String(timeText || "")
    .replace(/\s+/g, " ")
    .trim();
  const combined = `${normalizedDate} ${normalizedTime}`.trim();

  const parsedCombined = new Date(combined);
  if (!Number.isNaN(parsedCombined.getTime())) return parsedCombined;

  const shortYearMatch = normalizedDate.match(
    /^(\d{1,2})\s+([A-Za-z]{3})\s+'?(\d{2})$/i,
  );
  if (shortYearMatch) {
    const day = shortYearMatch[1];
    const month = shortYearMatch[2];
    const year = `20${shortYearMatch[3]}`;
    const rebuilt = `${day} ${month} ${year} ${normalizedTime}`.trim();
    const parsedRebuilt = new Date(rebuilt);
    if (!Number.isNaN(parsedRebuilt.getTime())) return parsedRebuilt;
  }

  const parsedDateOnly = new Date(normalizedDate);
  if (!Number.isNaN(parsedDateOnly.getTime())) return parsedDateOnly;

  return new Date();
}

function normalizeMoney(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.round(value);
    }
    if (typeof value === "string") {
      const n = parseFloat(value.replace(/[^0-9.]/g, ""));
      if (!Number.isNaN(n)) return Math.round(n);
    }
  }
  return 0;
}

function normalizeDistance(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 100 ? Number((value / 1000).toFixed(1)) : value;
    }
    if (typeof value === "string") {
      const n = parseFloat(value.replace(/[^0-9.]/g, ""));
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;

  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return new Date();
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function stringFrom(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return "";
}

function nestedValue(
  obj: Record<string, unknown>,
  key: string,
  nestedKey: string,
): unknown {
  const parent = obj[key];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
    return undefined;
  }
  return (parent as Record<string, unknown>)[nestedKey];
}

function cleanAddress(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(from|to)\s+/i, "")
    .trim();
}

function buildSyntheticTripId(
  startAddress: string,
  endAddress: string,
  startTime: Date,
): string {
  return `rapido-${simpleHash(
    `${startAddress}|${endAddress}|${startTime.toISOString()}`,
  )}`;
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function walk(input: unknown, visit: (node: unknown) => void): void {
  visit(input);

  if (Array.isArray(input)) {
    for (const item of input) walk(item, visit);
    return;
  }

  if (input && typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) {
      walk(value, visit);
    }
  }
}

function buildDemoTrips(): RapidoTrip[] {
  const now = new Date();

  const mk = (
    id: string,
    daysAgo: number,
    startAddress: string,
    endAddress: string,
    fare: number,
    distanceKm: number,
    rideType: string,
  ): RapidoTrip => {
    const start = new Date(now.getTime() - daysAgo * 24 * 60 * 60_000);
    start.setHours(9, 10, 0, 0);
    const end = new Date(start.getTime() + 22 * 60_000);

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
    mk(
      "rapido-demo-1",
      1,
      "Home, HSR Layout",
      "Office, Koramangala",
      92,
      7.8,
      "bike",
    ),
    mk(
      "rapido-demo-2",
      2,
      "Office, Koramangala",
      "Gym, Indiranagar",
      74,
      4.2,
      "bike",
    ),
    mk(
      "rapido-demo-3",
      4,
      "Home, HSR Layout",
      "Office, Koramangala",
      96,
      7.8,
      "bike",
    ),
    mk(
      "rapido-demo-4",
      6,
      "Home, HSR Layout",
      "Mall, Indiranagar",
      118,
      9.5,
      "bike",
    ),
  ];
}

function dedupe(trips: RapidoTrip[]): RapidoTrip[] {
  const seen = new Set<string>();
  const out: RapidoTrip[] = [];

  for (const trip of trips) {
    if (seen.has(trip.tripId)) continue;
    seen.add(trip.tripId);
    out.push(trip);
  }

  return out.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
}
