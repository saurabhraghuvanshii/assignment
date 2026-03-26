import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordFoodConfirmation } from '@/lib/food-trigger-engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { suggestionId, platform } = body;

    if (!suggestionId) {
      return NextResponse.json({ error: 'suggestionId is required' }, { status: 400 });
    }

    const suggestion = await prisma.foodSuggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    const updated = await prisma.foodSuggestion.update({
      where: { id: suggestionId },
      data: {
        status: 'confirmed',
        confirmedPlatform: platform || null,
      },
    });

    await prisma.foodSuggestionFeedback.create({
      data: {
        userId: suggestion.userId,
        suggestionId,
        action: 'confirmed',
      },
    });

    if (suggestion.patternId) {
      await recordFoodConfirmation(suggestion.userId, suggestion.patternId);
    }

    return NextResponse.json({
      success: true,
      suggestion: updated,
    });
  } catch (error) {
    console.error('Error confirming food suggestion:', error);
    return NextResponse.json({ error: 'Failed to confirm' }, { status: 500 });
  }
}
