import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updateStoredFoodPatterns } from '@/lib/food-learning-engine';
import { evaluateFoodTriggers } from '@/lib/food-trigger-engine';
import { buildFoodSuggestion } from '@/lib/food-suggestion-builder';
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
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 });
    }

    await updateStoredFoodPatterns(user.id);

    const triggerResult = await evaluateFoodTriggers(user.id);

    if (!triggerResult.shouldTrigger || !triggerResult.pattern) {
      return NextResponse.json({
        hasSuggestion: false,
        reason: triggerResult.reason,
        suggestion: null,
      });
    }

    const suggestion = await buildFoodSuggestion(user.id, triggerResult.pattern);

    return NextResponse.json({
      hasSuggestion: true,
      reason: triggerResult.reason,
      suggestion,
      user: {
        name: user.name,
        homeAddress: user.homeAddress,
      },
    });
  } catch (error) {
    console.error('Error generating food suggestion:', error);
    return NextResponse.json(
      { error: 'Failed to generate suggestion', hasSuggestion: false, suggestion: null },
      { status: 500 }
    );
  }
}
