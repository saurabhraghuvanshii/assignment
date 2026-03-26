import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { suggestionId, editedFields } = body;

    if (!suggestionId) {
      return NextResponse.json({ error: 'suggestionId is required' }, { status: 400 });
    }

    const suggestion = await prisma.foodSuggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = { status: 'edited' };

    if (editedFields?.restaurant) {
      updateData.restaurantName = editedFields.restaurant;
    }

    if (editedFields?.items) {
      updateData.items = editedFields.items;
    }

    if (editedFields?.platform) {
      updateData.platform = editedFields.platform;
      updateData.confirmedPlatform = editedFields.platform;
    }

    const updated = await prisma.foodSuggestion.update({
      where: { id: suggestionId },
      data: updateData,
    });

    await prisma.foodSuggestionFeedback.create({
      data: {
        userId: suggestion.userId,
        suggestionId,
        action: 'edited',
        editedFields: editedFields || {},
      },
    });

    return NextResponse.json({
      success: true,
      suggestion: updated,
    });
  } catch (error) {
    console.error('Error editing food suggestion:', error);
    return NextResponse.json({ error: 'Failed to edit' }, { status: 500 });
  }
}
