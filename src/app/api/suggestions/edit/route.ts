import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { suggestionId, editedFields } = body;

    if (!suggestionId) {
      return NextResponse.json({ error: 'suggestionId is required' }, { status: 400 });
    }

    const suggestion = await prisma.suggestion.findUnique({
      where: { id: suggestionId },
    });

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    // Build update data from edited fields
    const updateData: Record<string, unknown> = { status: 'edited' };

    if (editedFields?.origin) {
      updateData.originAddress = editedFields.origin.address;
      if (editedFields.origin.lat) updateData.originLat = editedFields.origin.lat;
      if (editedFields.origin.lng) updateData.originLng = editedFields.origin.lng;
    }

    if (editedFields?.destination) {
      updateData.destAddress = editedFields.destination.address;
      if (editedFields.destination.lat) updateData.destLat = editedFields.destination.lat;
      if (editedFields.destination.lng) updateData.destLng = editedFields.destination.lng;
    }

    if (editedFields?.departureTime) {
      updateData.suggestedDepartureTime = new Date(editedFields.departureTime);
    }

    if (editedFields?.platform) {
      updateData.confirmedPlatform = editedFields.platform;
    }

    if (editedFields?.rideType) {
      updateData.confirmedRideType = editedFields.rideType;
    }

    // Update the suggestion
    const updated = await prisma.suggestion.update({
      where: { id: suggestionId },
      data: updateData,
    });

    // Record feedback with which fields were edited
    await prisma.suggestionFeedback.create({
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
      message: 'Suggestion updated',
    });
  } catch (error) {
    console.error('Error editing suggestion:', error);
    return NextResponse.json({ error: 'Failed to edit suggestion' }, { status: 500 });
  }
}
