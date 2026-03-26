import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const platform = searchParams.get('platform');
    const cuisine = searchParams.get('cuisine');

    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const where: Record<string, unknown> = { userId };
    if (platform) where.platform = platform;
    if (cuisine) where.cuisine = cuisine;

    const [orders, total] = await Promise.all([
      prisma.foodOrderHistory.findMany({
        where,
        orderBy: { orderTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.foodOrderHistory.count({ where }),
    ]);

    return NextResponse.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching order history:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
