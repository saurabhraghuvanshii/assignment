/**
 * Zomato HTTP scraper.
 * Fetches restaurant listings, delivery ETAs, and prices from Zomato's
 * internal webroutes API (the same JSON endpoints their frontend calls).
 *
 * Verified endpoint: GET /webroutes/getPage?page_url=/delivery
 * Returns SECTION_SEARCH_RESULT with restaurant cards including:
 *   - name, rating, cuisines, delivery time, cost, distance
 *   - order URL for the restaurant
 *
 * Menu data is loaded separately by Zomato's frontend and requires
 * session cookies, so we don't scrape menus. The caller falls back
 * to simulated menu items when needed.
 */

const ZOMATO_BASE = 'https://www.zomato.com';
const REQUEST_TIMEOUT_MS = 12_000;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'X-Requested-With': 'XMLHttpRequest',
};

// ----- Public interfaces -----

export interface ZomatoRestaurant {
  resId: number;
  name: string;
  orderUrl: string;
  cuisines: string[];
  cuisineString: string;
  aggregateRating: number;
  deliveryRating: number;
  deliveryTimeStr: string;
  deliveryTimeMin: number;
  costForOne: number;
  costForTwo: number;
  distance: string;
  locality: string;
  imageUrl: string;
  isOpen: boolean;
  isServiceable: boolean;
  promoOffer: string;
}

export interface ZomatoSearchResult {
  restaurants: ZomatoRestaurant[];
  totalFound: number;
  city: string;
  fetchedAt: Date;
}

// ----- Main search function -----

/**
 * Search for restaurants on Zomato via their getPage webroutes API.
 * This returns real restaurant data: names, ratings, delivery times, prices.
 */
export async function searchRestaurants(
  query: string,
  limit = 8
): Promise<ZomatoRestaurant[]> {
  const pageUrl = query
    ? `/delivery?q=${encodeURIComponent(query)}`
    : `/delivery`;

  const apiUrl = `${ZOMATO_BASE}/webroutes/getPage?page_url=${encodeURIComponent(pageUrl)}&location=&isMobile=0`;

  const res = await fetch(apiUrl, {
    headers: {
      ...HEADERS,
      Referer: `${ZOMATO_BASE}${pageUrl}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Zomato API returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const restaurants = parseSearchResult(data);

  console.log(`[Zomato Scraper] Found ${restaurants.length} restaurants for "${query}" (user default location)`);
  return restaurants.slice(0, limit);
}

/**
 * Get restaurant basic info (rating, cuisines, status).
 * Menu items are NOT available via this endpoint - Zomato loads them
 * via a separate authenticated endpoint.
 */
export async function getRestaurantDetails(
  restaurantPath: string
): Promise<{
  name: string;
  cuisines: string[];
  rating: number;
  deliveryRating: number;
  isOpen: boolean;
}> {
  const cleanPath = restaurantPath.replace('/order', '');
  const apiUrl = `${ZOMATO_BASE}/webroutes/getPage?page_url=${encodeURIComponent(cleanPath)}/order&location=&isMobile=0`;

  const res = await fetch(apiUrl, {
    headers: {
      ...HEADERS,
      Referer: `${ZOMATO_BASE}${cleanPath}/order`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as Record<string, unknown>;
  const pageData = data.page_data as Record<string, unknown> | undefined;
  const sections = (pageData?.sections ?? {}) as Record<string, unknown>;
  const basic = (sections.SECTION_BASIC_INFO ?? {}) as Record<string, unknown>;
  const ratingObj = basic.rating as Record<string, unknown> | undefined;
  const ratingNew = basic.rating_new as Record<string, unknown> | undefined;
  const ratings = (ratingNew?.ratings ?? {}) as Record<string, Record<string, unknown>>;
  const deliveryRating = ratings.DELIVERY;

  return {
    name: String(basic.name ?? ''),
    cuisines: String(basic.cuisine_string ?? '').split(',').map(s => s.trim()).filter(Boolean),
    rating: parseFloat(String(ratingObj?.aggregate_rating ?? '0')),
    deliveryRating: parseFloat(String(deliveryRating?.rating ?? ratingObj?.aggregate_rating ?? '0')),
    isOpen: basic.is_temp_closed !== true && basic.is_perm_closed !== true,
  };
}

// ----- Parsing -----

function parseSearchResult(data: Record<string, unknown>): ZomatoRestaurant[] {
  const pageData = data.page_data as Record<string, unknown> | undefined;
  if (!pageData) return [];

  const sections = (pageData.sections ?? {}) as Record<string, unknown>;
  const searchResults = (sections.SECTION_SEARCH_RESULT ?? []) as Record<string, unknown>[];

  const restaurants: ZomatoRestaurant[] = [];

  for (const section of searchResults) {
    // Restaurant cards have type: "restaurant" and contain an "info" object
    if (section.type !== 'restaurant') continue;

    const info = section.info as Record<string, unknown> | undefined;
    const order = section.order as Record<string, unknown> | undefined;
    if (!info) continue;

    const ratingObj = info.rating as Record<string, unknown> | undefined;
    const ratingNew = info.ratingNew as Record<string, unknown> | undefined;
    const ratings = (ratingNew?.ratings ?? {}) as Record<string, Record<string, unknown>>;
    const deliveryRating = ratings.DELIVERY;
    const cuisineArr = (info.cuisine ?? []) as Array<{ name: string }>;
    const locality = info.locality as Record<string, unknown> | undefined;
    const cft = info.cft as Record<string, string> | undefined;
    const cfo = info.cfo as Record<string, string> | undefined;
    const image = info.image as Record<string, string> | undefined;
    const orderAction = order?.actionInfo as Record<string, string> | undefined;
    const promoOffer = section.promoOffer as string | undefined;
    const cardAction = section.cardAction as Record<string, string> | undefined;

    const deliveryTimeStr = String(order?.deliveryTime ?? '35 min');
    const deliveryTimeMatch = deliveryTimeStr.match(/(\d+)/);
    const deliveryTimeMin = deliveryTimeMatch ? parseInt(deliveryTimeMatch[1], 10) : 35;

    const costForTwoStr = String(cft?.text ?? '');
    const costForOneStr = String(cfo?.text ?? '');

    restaurants.push({
      resId: Number(info.resId ?? 0),
      name: String(info.name ?? ''),
      orderUrl: orderAction?.clickUrl ?? cardAction?.clickUrl ?? '',
      cuisines: cuisineArr.map(c => c.name),
      cuisineString: cuisineArr.map(c => c.name).join(', '),
      aggregateRating: parseFloat(String(ratingObj?.aggregate_rating ?? '0')),
      deliveryRating: parseFloat(String(deliveryRating?.rating ?? ratingObj?.aggregate_rating ?? '0')),
      deliveryTimeStr,
      deliveryTimeMin,
      costForOne: extractPrice(costForOneStr),
      costForTwo: extractPrice(costForTwoStr),
      distance: String(section.distance ?? ''),
      locality: String(locality?.name ?? ''),
      imageUrl: image?.url ?? '',
      isOpen: info.is_temp_closed !== true && info.is_perm_closed !== true,
      isServiceable: order?.isServiceable === true,
      promoOffer: promoOffer ?? '',
    });
  }

  // Also extract from "brands" section as supplementary data
  for (const section of searchResults) {
    if (section.type !== 'brands') continue;
    const items = (section.items ?? []) as Record<string, unknown>[];
    for (const item of items) {
      const alreadyAdded = restaurants.some(r => r.name === String(item.name ?? ''));
      if (alreadyAdded) continue;

      const deliveryTimeStr = String(item.deliveryTime ?? '35 min');
      const dtMatch = deliveryTimeStr.match(/(\d+)/);

      restaurants.push({
        resId: Number(item.res_id ?? 0),
        name: String(item.name ?? ''),
        orderUrl: String((item.actionInfo as Record<string, string>)?.clickUrl ?? ''),
        cuisines: [],
        cuisineString: '',
        aggregateRating: 0,
        deliveryRating: 0,
        deliveryTimeStr,
        deliveryTimeMin: dtMatch ? parseInt(dtMatch[1], 10) : 35,
        costForOne: 300,
        costForTwo: 600,
        distance: '',
        locality: '',
        imageUrl: String((item.image as Record<string, string>)?.url ?? ''),
        isOpen: true,
        isServiceable: true,
        promoOffer: '',
      });
    }
  }

  return restaurants;
}

function extractPrice(text: string): number {
  const match = text.match(/[\d,]+/);
  if (!match) return 0;
  return parseInt(match[0].replace(/,/g, ''), 10);
}
