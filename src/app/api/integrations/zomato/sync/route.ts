import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { decryptString } from '@/lib/crypto';
import {
  fetchAllUserOrders,
  type ZomatoAuthCookies,
  type ZomatoOrder,
} from '@/lib/scrapers/zomato-user-scraper';

export async function POST() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'zomato' } },
  });

  if (!integration?.sessionEncrypted) {
    return NextResponse.json({ error: 'Zomato not connected' }, { status: 400 });
  }

  try {
    const cookieJson = decryptString(integration.sessionEncrypted);
    const cookies = JSON.parse(cookieJson) as ZomatoAuthCookies;

    const orders = await fetchAllUserOrders(cookies, 30);
    const imported = await importOrders(userId, orders);

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: `ok: imported ${imported} orders`,
        status: 'connected',
      },
    });

    return NextResponse.json({ success: true, imported, totalFetched: orders.length });
  } catch (e) {
    console.error('Zomato sync error:', e);
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: `error: ${(e as Error).message}`,
        status: 'error',
      },
    });
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

async function importOrders(userId: string, orders: ZomatoOrder[]): Promise<number> {
  let imported = 0;

  for (const o of orders) {
    // Zomato endpoint doesn’t always provide item breakdown; keep it in `items` if present.
    const dayOfWeek = o.orderTime.getDay();
    const cuisine = (o.establishment ?? 'unknown').toLowerCase() || 'unknown';

    // Upsert-ish: if exact order already exists (same user+time+restaurant+cost), skip.
    const existing = await prisma.foodOrderHistory.findFirst({
      where: {
        userId,
        platform: 'zomato',
        restaurantName: o.restaurantName,
        totalCost: o.totalCost,
        orderTime: o.orderTime,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.foodOrderHistory.create({
      data: {
        userId,
        platform: 'zomato',
        restaurantName: o.restaurantName || 'Unknown Restaurant',
        items: o.items.length > 0 ? o.items : [{ name: 'Unknown items', quantity: 1 }],
        cuisine,
        totalCost: o.totalCost || 0,
        deliveryFee: 0,
        orderTime: o.orderTime,
        deliveryDurationMinutes: null,
        dayOfWeek,
        rating: null,
      },
    });
    imported++;
  }

  return imported;
}

