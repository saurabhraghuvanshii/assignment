import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const platform = searchParams.get('platform');

    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const where: Record<string, unknown> = { userId };
    if (platform) where.platform = platform;

    const [rides, total] = await Promise.all([
      prisma.rideHistory.findMany({
        where,
        orderBy: { departureTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.rideHistory.count({ where }),
    ]);

    return NextResponse.json({
      rides,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching ride history:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
