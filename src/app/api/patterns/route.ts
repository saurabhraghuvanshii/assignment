import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET() {
  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const patterns = await prisma.locationPattern.findMany({
      where: { userId },
      orderBy: [{ confidence: 'desc' }, { frequency: 'desc' }],
    });

    return NextResponse.json({ patterns });
  } catch (error) {
    console.error('Error fetching patterns:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
