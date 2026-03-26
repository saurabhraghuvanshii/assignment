import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const integrations = await prisma.integration.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      provider: true,
      status: true,
      scopes: true,
      lastSyncAt: true,
      lastSyncStatus: true,
      sessionLast4: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ integrations });
}

