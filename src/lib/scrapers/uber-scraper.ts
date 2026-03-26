/**
 * Uber HTTP scraper.
 * Fetches ride price estimates, ETAs, and surge pricing from Uber's web endpoints.
 *
 * Strategy:
 *  1. Try Uber's fare estimate API (the endpoint their price-estimate page calls)
 *  2. Fallback: scrape the price-estimate HTML page for embedded data
 *  3. Caller falls back to simulated data if scraper throws
 */

import * as cheerio from 'cheerio';

const UBER_BASE = 'https://www.uber.com';
const REQUEST_TIMEOUT_MS = 12_000;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const JSON_HEADERS: Record<string, string> = {
  ...HEADERS,
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'X-Requested-With': 'XMLHttpRequest',
};

// ----- Public interfaces -----

export interface UberEstimate {
  productName: string; // UberGo, Premier, Auto, Moto, etc.
  productId?: string;
  priceEstimate: string; // e.g. "₹150-180"
  lowPrice: number;
  highPrice: number;
  currency: string;
  etaMinutes: number;
  tripDurationMinutes: number;
  distanceKm: number;
  surgeMultiplier: number;
  surgeActive: boolean;
}

// Mapping from Uber product names to our internal ride types
const PRODUCT_TO_RIDE_TYPE: Record<string, string> = {
  ubergo: 'cab',
  'uber go': 'cab',
  go: 'cab',
  uberx: 'cab',
  premier: 'premium',
  'uber premier': 'premium',
  'uber xl': 'premium',
  uberxl: 'premium',
  auto: 'auto',
  'uber auto': 'auto',
  'tuk tuk': 'auto',
  moto: 'bike',
  'uber moto': 'bike',
  bike: 'bike',
};

export function mapProductToRideType(productName: string): string {
  const lower = productName.toLowerCase().trim();
  return PRODUCT_TO_RIDE_TYPE[lower] ?? 'cab';
}

// ----- Main scraper function -----

export async function getUberEstimates(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): Promise<UberEstimate[]> {
  // Strategy 1: Try Uber's fare estimate API endpoint
  try {
    const estimates = await tryFareEstimateAPI(pickupLat, pickupLng, dropoffLat, dropoffLng);
    if (estimates.length > 0) {
      console.log(`[Uber] API returned ${estimates.length} estimates`);
      return estimates;
    }
  } catch (e) {
    console.warn('[Uber] Fare estimate API failed:', (e as Error).message);
  }

  // Strategy 2: Scrape the price-estimate page
  try {
    const estimates = await tryPriceEstimatePage(pickupLat, pickupLng, dropoffLat, dropoffLng);
    if (estimates.length > 0) {
      console.log(`[Uber] Price estimate page returned ${estimates.length} estimates`);
      return estimates;
    }
  } catch (e) {
    console.warn('[Uber] Price estimate page failed:', (e as Error).message);
  }

  // Strategy 3: Try the mobile web endpoint
  try {
    const estimates = await tryMobileWebEstimate(pickupLat, pickupLng, dropoffLat, dropoffLng);
    if (estimates.length > 0) {
      console.log(`[Uber] Mobile web returned ${estimates.length} estimates`);
      return estimates;
    }
  } catch (e) {
    console.warn('[Uber] Mobile web failed:', (e as Error).message);
  }

  throw new Error('All Uber scraping strategies failed');
}

// ----- Strategy 1: Uber API endpoints -----

async function tryFareEstimateAPI(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): Promise<UberEstimate[]> {
  // First, fetch the price estimate page to get a CSRF token
  const pageUrl = `${UBER_BASE}/global/en/price-estimate/`;
  const pageRes = await fetch(pageUrl, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!pageRes.ok) throw new Error(`Page fetch HTTP ${pageRes.status}`);

  const cookies = pageRes.headers
    .getSetCookie?.()
    ?.join('; ') ?? '';
  const html = await pageRes.text();

  // Extract CSRF token from the page
  const csrfMatch = html.match(/csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)/i);
  const csrf = csrfMatch?.[1] ?? '';

  // Try the loadFEEstimates endpoint
  const apiUrl = `${UBER_BASE}/api/loadFEEstimates?localeCode=en`;
  const body = {
    origin: { latitude: pickupLat, longitude: pickupLng },
    destination: { latitude: dropoffLat, longitude: dropoffLng },
    locale: 'en',
  };

  const apiRes = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Cookie: cookies,
      Referer: pageUrl,
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!apiRes.ok) throw new Error(`API HTTP ${apiRes.status}`);

  const data = (await apiRes.json()) as Record<string, unknown>;
  return parseUberAPIResponse(data);
}

// ----- Strategy 2: Scrape price-estimate page HTML -----

async function tryPriceEstimatePage(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): Promise<UberEstimate[]> {
  const url =
    `${UBER_BASE}/global/en/price-estimate/` +
    `?pickup=${pickupLat},${pickupLng}&dropoff=${dropoffLat},${dropoffLng}`;

  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  return parsePriceEstimateHTML(html);
}

// ----- Strategy 3: Mobile web -----

async function tryMobileWebEstimate(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): Promise<UberEstimate[]> {
  const url =
    `https://m.uber.com/go/product-selection` +
    `?pickup=${pickupLat},${pickupLng}&dropoff=${dropoffLat},${dropoffLng}`;

  const res = await fetch(url, {
    headers: {
      ...HEADERS,
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  return parseMobileHTML(html);
}

// ----- Response parsers -----

function parseUberAPIResponse(data: Record<string, unknown>): UberEstimate[] {
  const results: UberEstimate[] = [];

  // The response could have different structures
  const estimates =
    (data.estimates ??
      data.prices ??
      data.fareEstimates ??
      data.products ??
      []) as Record<string, unknown>[];

  for (const est of estimates) {
    const name = String(
      est.productName ??
        est.display_name ??
        est.localized_display_name ??
        est.vehicleViewDisplayName ??
        ''
    );
    if (!name) continue;

    const low = safeFloat(est.lowEstimate ?? est.low_estimate ?? est.minimum);
    const high = safeFloat(est.highEstimate ?? est.high_estimate ?? est.maximum ?? low * 1.2);
    const eta = safeFloat(est.eta ?? est.pickup_estimate ?? est.etaMinutes);
    const dur = safeFloat(est.duration ?? est.trip_duration ?? est.tripDurationMinutes);
    const dist = safeFloat(est.distance ?? est.trip_distance ?? est.distanceKm);
    const surge = safeFloat(est.surgeMultiplier ?? est.surge_multiplier ?? est.multiplier ?? 1);

    results.push({
      productName: name,
      priceEstimate:
        String(est.estimate ?? est.fare_string ?? est.priceEstimate ?? `₹${low}-${high}`),
      lowPrice: low,
      highPrice: high,
      currency: String(est.currency_code ?? est.currency ?? 'INR'),
      etaMinutes: Math.round(eta / 60) || Math.round(eta) || 5,
      tripDurationMinutes: Math.round(dur / 60) || Math.round(dur) || 20,
      distanceKm: dist > 100 ? dist / 1000 : dist,
      surgeMultiplier: surge,
      surgeActive: surge > 1.0,
    });
  }

  return results;
}

function parsePriceEstimateHTML(html: string): UberEstimate[] {
  const $ = cheerio.load(html);
  const results: UberEstimate[] = [];

  // Try embedded JSON data (__NEXT_DATA__ or inline scripts)
  const nd = $('script#__NEXT_DATA__').html();
  if (nd) {
    try {
      const j = JSON.parse(nd);
      const props = j?.props?.pageProps;
      if (props) {
        const estimates =
          props.fareEstimates ?? props.estimates ?? props.products ?? [];
        if (Array.isArray(estimates) && estimates.length > 0) {
          return parseUberAPIResponse({ estimates } as Record<string, unknown>);
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Try to find estimate data in inline scripts
  $('script').each((_, el) => {
    const text = $(el).html() ?? '';
    if (text.includes('fareEstimate') || text.includes('priceEstimate') || text.includes('productName')) {
      // Try to extract JSON objects from the script
      const jsonMatches = text.match(/\{[^{}]*"(?:fareEstimate|productName|display_name)"[^{}]*\}/g);
      if (jsonMatches) {
        for (const match of jsonMatches) {
          try {
            const obj = JSON.parse(match);
            const name = String(obj.productName ?? obj.display_name ?? '');
            if (name) {
              results.push({
                productName: name,
                priceEstimate: String(obj.estimate ?? obj.fare_string ?? ''),
                lowPrice: safeFloat(obj.lowEstimate ?? obj.low_estimate),
                highPrice: safeFloat(obj.highEstimate ?? obj.high_estimate),
                currency: 'INR',
                etaMinutes: safeFloat(obj.eta ?? obj.pickup_estimate) || 5,
                tripDurationMinutes: safeFloat(obj.duration) || 20,
                distanceKm: safeFloat(obj.distance) || 7,
                surgeMultiplier: safeFloat(obj.surgeMultiplier ?? 1),
                surgeActive: safeFloat(obj.surgeMultiplier ?? 1) > 1,
              });
            }
          } catch {
            /* ignore malformed JSON */
          }
        }
      }
    }
  });

  // Try extracting from visible DOM elements
  if (results.length === 0) {
    $('[data-testid*="product"], [class*="product-card"], [class*="fare-estimate"]').each(
      (_, el) => {
        const $el = $(el);
        const name = $el.find('[class*="name"], [class*="title"]').first().text().trim();
        const price = $el.find('[class*="price"], [class*="fare"]').first().text().trim();
        const eta = $el.find('[class*="eta"], [class*="time"]').first().text().trim();

        if (name && price) {
          const priceNums = price.match(/\d+/g)?.map(Number) ?? [0];
          results.push({
            productName: name,
            priceEstimate: price,
            lowPrice: priceNums[0],
            highPrice: priceNums[1] ?? priceNums[0],
            currency: 'INR',
            etaMinutes: parseInt(eta) || 5,
            tripDurationMinutes: 20,
            distanceKm: 7,
            surgeMultiplier: 1,
            surgeActive: false,
          });
        }
      }
    );
  }

  return results;
}

function parseMobileHTML(html: string): UberEstimate[] {
  const $ = cheerio.load(html);
  let results: UberEstimate[] = [];

  // Try to find embedded state/data
  $('script').each((_, el) => {
    if (results.length > 0) return;
    const text = $(el).html() ?? '';
    if (
      text.includes('product') &&
      (text.includes('fare') || text.includes('price') || text.includes('estimate'))
    ) {
      const stateMatch = text.match(
        /(?:window\.__[A-Z_]+__|__STORE__|initialState)\s*=\s*(\{[\s\S]*?\});/
      );
      if (stateMatch) {
        try {
          const state = JSON.parse(stateMatch[1]);
          const products =
            state.products ?? state.fareEstimates ?? state.estimates ?? [];
          if (Array.isArray(products)) {
            results = parseUberAPIResponse({ estimates: products } as Record<string, unknown>);
          }
        } catch {
          /* ignore */
        }
      }
    }
  });

  if (results.length > 0) return results;

  // DOM-based extraction
  $('[class*="product"], [class*="ride-option"]').each((_, el) => {
    const $el = $(el);
    const name = $el.find('[class*="name"]').first().text().trim();
    const price = $el.find('[class*="price"]').first().text().trim();

    if (name && price) {
      const nums = price.match(/\d+/g)?.map(Number) ?? [0];
      results.push({
        productName: name,
        priceEstimate: price,
        lowPrice: nums[0],
        highPrice: nums[1] ?? nums[0],
        currency: 'INR',
        etaMinutes: 5,
        tripDurationMinutes: 20,
        distanceKm: 7,
        surgeMultiplier: 1,
        surgeActive: false,
      });
    }
  });

  return results;
}

// ----- Utilities -----

function safeFloat(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}
