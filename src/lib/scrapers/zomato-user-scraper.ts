/**
 * Zomato user-data scraper (authenticated).
 *
 * This fetches *real user order history* from Zomato's internal endpoint:
 *   GET https://www.zomato.com/webroutes/user/orders?page=N
 *
 * Auth method: Zomato web session cookies. Commonly needed cookies:
 *  - cid
 *  - PHPSESSID
 *  - zat
 *
 * The user provides these via the UI integration flow.
 */

export type ZomatoAuthCookies = {
  cid: string;
  PHPSESSID: string;
  zat: string;
  user_city_ids?: string; // location context required for some accounts/regions
};

export type ZomatoOrder = {
  orderId: string;
  orderDateRaw: string;
  orderTime: Date;
  restaurantId: string;
  restaurantName: string;
  totalCost: number;
  currency: string;
  establishment: string | null;
  items: Array<{ name: string; quantity: number; price?: number }>;
};

const ORDERS_ENDPOINT = 'https://www.zomato.com/webroutes/user/orders';
const REQUEST_TIMEOUT_MS = 15_000;

export function cookiesToHeader(cookies: ZomatoAuthCookies): string {
  // Keep it minimal: only cookies we need (include location if present)
  const parts: string[] = [`cid=${cookies.cid}`, `PHPSESSID=${cookies.PHPSESSID}`, `zat=${cookies.zat}`];
  if (cookies.user_city_ids) parts.push(`user_city_ids=${cookies.user_city_ids}`);
  return parts.join('; ');
}

export function maskSecret(s: string): string {
  if (!s) return '';
  if (s.length <= 4) return s;
  return s.slice(-4);
}

export async function fetchAllUserOrders(
  cookies: ZomatoAuthCookies,
  maxPages = 20
): Promise<ZomatoOrder[]> {
  const all: ZomatoOrder[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const pageOrders = await fetchUserOrdersPage(cookies, page);
    if (pageOrders.length === 0) break;
    all.push(...pageOrders);
    await sleep(400);
  }

  return dedupeOrders(all);
}

export async function fetchUserOrdersPage(
  cookies: ZomatoAuthCookies,
  page: number
): Promise<ZomatoOrder[]> {
  const url = new URL(ORDERS_ENDPOINT);
  url.searchParams.set('page', String(page));

  const res = await fetch(url.toString(), {
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      cookie: cookiesToHeader(cookies),
      pragma: 'no-cache',
      referer: 'https://www.zomato.com/',
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await safeText(res);
    throw new Error(`Zomato orders HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return parseOrdersResponse(data);
}

function parseOrdersResponse(data: Record<string, unknown>): ZomatoOrder[] {
  const entities = data.entities as Record<string, unknown> | undefined;
  const orderEntity = (entities?.ORDER ?? {}) as Record<string, unknown>;
  const ordersRaw = Object.values(orderEntity) as Array<Record<string, unknown>>;

  const orders: ZomatoOrder[] = [];

  for (const o of ordersRaw) {
    const orderId = String(o.orderId ?? '');
    if (!orderId) continue;

    const totalCostRaw = String(o.totalCost ?? '');
    const totalCost = normalizeMoney(totalCostRaw);
    const orderDateRaw = String(o.orderDate ?? '');
    const orderTime = parseOrderDate(orderDateRaw);

    const resInfo = (o.resInfo ?? {}) as Record<string, unknown>;
    const restaurantId = String(resInfo.id ?? '');
    const restaurantName = String(resInfo.name ?? '');
    const establishmentArr = (resInfo.establishment ?? []) as unknown[];
    const establishment =
      Array.isArray(establishmentArr) && establishmentArr.length > 0
        ? String(establishmentArr[0] ?? '')
        : null;

    // Items are sometimes present, sometimes not. Best-effort parsing.
    const items = extractItems(o);

    orders.push({
      orderId,
      orderDateRaw,
      orderTime,
      restaurantId,
      restaurantName,
      totalCost,
      currency: inferCurrency(totalCostRaw),
      establishment,
      items,
    });
  }

  return orders;
}

function extractItems(order: Record<string, unknown>): Array<{ name: string; quantity: number; price?: number }> {
  const items: Array<{ name: string; quantity: number; price?: number }> = [];

  // Common shapes seen in Zomato responses vary. Try a few.
  const cart = (order.cart ?? order.orderItems ?? order.items ?? null) as unknown;
  const candidates: unknown[] = Array.isArray(cart) ? cart : [];

  for (const it of candidates) {
    if (!it || typeof it !== 'object') continue;
    const obj = it as Record<string, unknown>;
    const name = String(obj.name ?? obj.itemName ?? obj.dishName ?? '').trim();
    if (!name) continue;
    const qty = typeof obj.quantity === 'number' ? obj.quantity : parseInt(String(obj.quantity ?? '1'), 10) || 1;
    const price = typeof obj.price === 'number' ? obj.price : normalizeMoney(String(obj.price ?? ''));
    items.push({ name, quantity: qty, ...(price ? { price } : {}) });
  }

  return items.length > 0 ? items : [];
}

function parseOrderDate(raw: string): Date {
  // Zomato uses human readable strings; Date parsing is best-effort.
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d;

  // Try a fallback: if empty, use now
  return new Date();
}

function normalizeMoney(raw: string): number {
  const cleaned = raw.replace(/[₹,\u20b9\s]/g, '').replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : Math.round(n);
}

function inferCurrency(raw: string): string {
  if (raw.includes('₹') || raw.includes('\u20b9')) return 'INR';
  return 'UNKNOWN';
}

function dedupeOrders(orders: ZomatoOrder[]): ZomatoOrder[] {
  const seen = new Set<string>();
  const out: ZomatoOrder[] = [];
  for (const o of orders) {
    if (seen.has(o.orderId)) continue;
    seen.add(o.orderId);
    out.push(o);
  }
  return out.sort((a, b) => b.orderTime.getTime() - a.orderTime.getTime());
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

