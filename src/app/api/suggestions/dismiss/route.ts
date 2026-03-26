import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordDismissal } from '@/lib/trigger-engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { suggestionId, reason } = body;

    if (!suggestionId) {
      return NextResponse.json({ error: 'suggestionId is required' }, { status: 400 });
    }

    const suggestion = await prisma.suggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    // Mark as dismissed
    await prisma.suggestion.update({
      where: { id: suggestionId },
      data: { status: 'dismissed' },
    });

    // Record feedback with optional reason
    await prisma.suggestionFeedback.create({
      data: {
        userId: suggestion.userId,
        suggestionId,
        action: 'dismissed',
        dismissReason: reason || null,
      },
    });

    // Update pattern dismissal count
    if (suggestion.patternId) {
      await recordDismissal(suggestion.userId, suggestion.patternId);
    }

    return NextResponse.json({
      success: true,
      message: 'Suggestion dismissed',
    });
  } catch (error) {
    console.error('Error dismissing suggestion:', error);
    return NextResponse.json({ error: 'Failed to dismiss suggestion' }, { status: 500 });
  }
}
