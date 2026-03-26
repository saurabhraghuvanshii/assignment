import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const platform = searchParams.get('platform');

    // For demo, use the first user
    const user = await prisma.user.findFirst();
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 });
    }

    const where: Record<string, unknown> = { userId: user.id };
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
