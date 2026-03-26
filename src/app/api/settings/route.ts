import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET() {
  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, homeAddress: true, workAddress: true },
    });
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      homeAddress: user.homeAddress,
      workAddress: user.workAddress,
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, homeAddress: true, workAddress: true },
    });
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 });
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name: body.name || user.name,
        homeAddress: body.homeAddress || user.homeAddress,
        workAddress: body.workAddress || user.workAddress,
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        name: updated.name,
        homeAddress: updated.homeAddress,
        workAddress: updated.workAddress,
      },
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
