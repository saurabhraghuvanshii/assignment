import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordFoodDismissal } from '@/lib/food-trigger-engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { suggestionId, reason } = body;

    if (!suggestionId) {
      return NextResponse.json({ error: 'suggestionId is required' }, { status: 400 });
    }

    const suggestion = await prisma.foodSuggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    await prisma.foodSuggestion.update({
      where: { id: suggestionId },
      data: { status: 'dismissed' },
    });

    await prisma.foodSuggestionFeedback.create({
      data: {
        userId: suggestion.userId,
        suggestionId,
        action: 'dismissed',
        dismissReason: reason || null,
      },
    });

    if (suggestion.patternId) {
      await recordFoodDismissal(suggestion.userId, suggestion.patternId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error dismissing food suggestion:', error);
    return NextResponse.json({ error: 'Failed to dismiss' }, { status: 500 });
  }
}
