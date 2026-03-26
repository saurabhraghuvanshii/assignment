import { prisma } from './prisma';
import { startOfDay, subDays, getDay, getHours } from 'date-fns';

interface PatternData {
  dayOfWeek: number;
  hourOfDay: number;
  originAddress: string;
  originLat: number;
  originLng: number;
  destAddress: string;
  destLat: number;
  destLng: number;
  count: number;
  recentCount: number;
  platforms: Record<string, number>;
  rideTypes: Record<string, number>;
}

/**
 * Analyzes ride history and extracts behavioral patterns.
 * Uses frequency analysis with recency decay to identify
 * when and where the user typically travels.
 */
export async function analyzePatterns(userId: string) {
  const rides = await prisma.rideHistory.findMany({
    where: { userId },
    orderBy: { departureTime: 'desc' },
  });

  if (rides.length === 0) return [];

  const thirtyDaysAgo = subDays(new Date(), 30);
  const patternMap = new Map<string, PatternData>();

  for (const ride of rides) {
    const dayOfWeek = ride.dayOfWeek;
    const hourOfDay = getHours(ride.departureTime);
    const key = `${dayOfWeek}-${hourOfDay}-${ride.destAddress}`;

    const isRecent = ride.departureTime >= thirtyDaysAgo;

    if (!patternMap.has(key)) {
      patternMap.set(key, {
        dayOfWeek,
        hourOfDay,
        originAddress: ride.originAddress,
        originLat: ride.originLat,
        originLng: ride.originLng,
        destAddress: ride.destAddress,
        destLat: ride.destLat,
        destLng: ride.destLng,
        count: 0,
        recentCount: 0,
        platforms: {},
        rideTypes: {},
      });
    }

    const pattern = patternMap.get(key)!;
    // Recency weighting: recent rides count 2x
    pattern.count += isRecent ? 2 : 1;
    if (isRecent) pattern.recentCount++;

    // Track platform and ride type preferences
    pattern.platforms[ride.platform] = (pattern.platforms[ride.platform] || 0) + (isRecent ? 2 : 1);
    pattern.rideTypes[ride.rideType] = (pattern.rideTypes[ride.rideType] || 0) + (isRecent ? 2 : 1);
  }

  // Convert to array and calculate confidence scores
  const patterns = Array.from(patternMap.values()).map((p) => {
    // Max possible rides for a day/hour combo over 90 days ≈ 13 occurrences, with 2× recency for recent ones
    const maxPossible = p.dayOfWeek >= 1 && p.dayOfWeek <= 5 ? 13 * 2 : 13 * 1.5;
    const rawConfidence = Math.min(p.count / maxPossible, 1);

    // Boost confidence if recent rides exist
    const recencyBoost = p.recentCount > 0 ? 0.1 : -0.1;
    const confidence = Math.max(0, Math.min(1, rawConfidence + recencyBoost));

    // Find preferred platform & ride type
    const preferredPlatform = Object.entries(p.platforms).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const preferredRideType = Object.entries(p.rideTypes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      dayOfWeek: p.dayOfWeek,
      hourOfDay: p.hourOfDay,
      originAddress: p.originAddress,
      originLat: p.originLat,
      originLng: p.originLng,
      destAddress: p.destAddress,
      destLat: p.destLat,
      destLng: p.destLng,
      confidence,
      frequency: Math.ceil(p.count / 2), // normalize back
      preferredPlatform,
      preferredRideType,
    };
  });

  // Filter to meaningful patterns only (confidence > 0.3)
  return patterns.filter((p) => p.confidence > 0.3).sort((a, b) => b.confidence - a.confidence);
}

/**
 * Applies feedback from user edits and dismissals to adjust pattern confidence.
 * Edits to destination reduce confidence of the original pattern.
 * Repeated dismissals already handled by trigger engine's consecutiveDismissals.
 */
async function applyFeedbackToPatterns(userId: string) {
  const recentFeedback = await prisma.suggestionFeedback.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { suggestion: true },
  });

  for (const fb of recentFeedback) {
    if (fb.action === 'edited' && fb.editedFields) {
      const fields = fb.editedFields as Record<string, unknown>;
      // If user edited the destination, slightly penalize the original pattern
      if (fields.destination && fb.suggestion) {
        await prisma.locationPattern.updateMany({
          where: {
            userId,
            destAddress: fb.suggestion.destAddress,
          },
          data: {
            confidence: { decrement: 0.02 },
          },
        });
      }
      // If user edited platform preference, update pattern's preferred platform
      if (fields.platform && fb.suggestion?.patternId) {
        await prisma.locationPattern.updateMany({
          where: { id: fb.suggestion.patternId },
          data: { preferredPlatform: fields.platform as string },
        });
      }
      if (fields.rideType && fb.suggestion?.patternId) {
        await prisma.locationPattern.updateMany({
          where: { id: fb.suggestion.patternId },
          data: { preferredRideType: fields.rideType as string },
        });
      }
    }
  }
}

/**
 * Persists learned patterns to the database, updating existing ones.
 * Also incorporates user feedback (edits, dismissals) into pattern weights.
 */
export async function updateStoredPatterns(userId: string) {
  const patterns = await analyzePatterns(userId);

  for (const pattern of patterns) {
    await prisma.locationPattern.upsert({
      where: {
        userId_dayOfWeek_hourOfDay_destAddress: {
          userId,
          dayOfWeek: pattern.dayOfWeek,
          hourOfDay: pattern.hourOfDay,
          destAddress: pattern.destAddress,
        },
      },
      update: {
        confidence: pattern.confidence,
        frequency: pattern.frequency,
        preferredPlatform: pattern.preferredPlatform,
        preferredRideType: pattern.preferredRideType,
        originAddress: pattern.originAddress,
        originLat: pattern.originLat,
        originLng: pattern.originLng,
        destLat: pattern.destLat,
        destLng: pattern.destLng,
      },
      create: {
        userId,
        ...pattern,
      },
    });
  }

  // Apply user feedback (edits, platform preferences) to pattern weights
  await applyFeedbackToPatterns(userId);

  return patterns;
}
