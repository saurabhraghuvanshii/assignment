import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const user = await prisma.user.findFirst();
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 });
    }

    const patterns = await prisma.locationPattern.findMany({
      where: { userId: user.id },
      orderBy: [{ confidence: 'desc' }, { frequency: 'desc' }],
    });

    return NextResponse.json({ patterns });
  } catch (error) {
    console.error('Error fetching patterns:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
