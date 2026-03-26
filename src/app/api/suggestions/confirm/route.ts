import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { recordConfirmation } from '@/lib/trigger-engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { suggestionId, platform, rideType } = body;

    if (!suggestionId) {
      return NextResponse.json({ error: 'suggestionId is required' }, { status: 400 });
    }

    const suggestion = await prisma.suggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    // Mark as confirmed
    const updated = await prisma.suggestion.update({
      where: { id: suggestionId },
      data: {
        status: 'confirmed',
        confirmedPlatform: platform || null,
        confirmedRideType: rideType || null,
      },
    });

    // Record feedback
    await prisma.suggestionFeedback.create({
      data: {
        userId: suggestion.userId,
        suggestionId,
        action: 'confirmed',
      },
    });

    // Reset consecutive dismissals for this pattern
    if (suggestion.patternId) {
      await recordConfirmation(suggestion.userId, suggestion.patternId);
    }

    return NextResponse.json({
      success: true,
      suggestion: updated,
      message: 'Ride confirmed!',
    });
  } catch (error) {
    console.error('Error confirming suggestion:', error);
    return NextResponse.json({ error: 'Failed to confirm suggestion' }, { status: 500 });
  }
}
