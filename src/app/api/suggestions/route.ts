import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { updateStoredPatterns } from '@/lib/learning-engine';
import { evaluateTriggers } from '@/lib/trigger-engine';
import { buildSuggestion } from '@/lib/suggestion-builder';

export async function GET() {
  try {
    // Get the demo user
    const user = await prisma.user.findFirst();
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 });
    }

    // Step 1: Update learned patterns from ride history
    await updateStoredPatterns(user.id);

    // Step 2: Evaluate if we should trigger a suggestion
    const triggerResult = await evaluateTriggers(user.id);

    if (!triggerResult.shouldTrigger || !triggerResult.pattern) {
      // No suggestion needed right now
      return NextResponse.json({
        hasSuggestion: false,
        reason: triggerResult.reason,
        suggestion: null,
      });
    }

    // Step 3: Build the complete suggestion with live data
    const suggestion = await buildSuggestion(user.id, triggerResult.pattern);

    return NextResponse.json({
      hasSuggestion: true,
      reason: triggerResult.reason,
      suggestion,
      user: {
        name: user.name,
        homeAddress: user.homeAddress,
        workAddress: user.workAddress,
      },
    });
  } catch (error) {
    console.error('Error generating suggestion:', error);
    return NextResponse.json(
      { error: 'Failed to generate suggestion', hasSuggestion: false, suggestion: null },
      { status: 500 }
    );
  }
}
