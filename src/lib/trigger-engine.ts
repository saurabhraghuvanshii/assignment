import { prisma } from './prisma';
import { getDay, getHours, subHours, startOfDay } from 'date-fns';

interface TriggerResult {
  shouldTrigger: boolean;
  pattern: {
    id: string;
    dayOfWeek: number;
    hourOfDay: number;
    originAddress: string;
    originLat: number;
    originLng: number;
    destAddress: string;
    destLat: number;
    destLng: number;
    confidence: number;
    preferredPlatform: string | null;
    preferredRideType: string | null;
  } | null;
  reason: string;
}

/**
 * The trigger engine decides WHEN to surface a proactive suggestion.
 * 
 * Signals watched:
 * - Time of day vs learned patterns
 * - Day of week vs learned patterns
 * - Confidence threshold (minimum 0.5)
 * 
 * Anti-annoyance measures:
 * - 2-hour cooldown after dismissal
 * - Skip if user already confirmed a ride for this pattern today
 * - Reduce confidence after 3+ consecutive dismissals
 * - Only trigger within ±30 min window of pattern time
 */
export async function evaluateTriggers(userId: string): Promise<TriggerResult> {
  const now = new Date();
  const currentDay = getDay(now);
  const currentHour = getHours(now);
  const currentMinutes = now.getMinutes();

  // Get all patterns for the current day
  const patterns = await prisma.locationPattern.findMany({
    where: {
      userId,
      dayOfWeek: currentDay,
      confidence: { gte: 0.5 },
    },
    orderBy: { confidence: 'desc' },
  });

  if (patterns.length === 0) {
    return { shouldTrigger: false, pattern: null, reason: 'No matching patterns for today' };
  }

  for (const pattern of patterns) {
    // Check time window: trigger if within ±30 min of pattern hour
    const patternMinuteOfDay = pattern.hourOfDay * 60;
    const currentMinuteOfDay = currentHour * 60 + currentMinutes;
    const timeDiff = Math.abs(currentMinuteOfDay - patternMinuteOfDay);

    if (timeDiff > 30) {
      continue; // Outside trigger window
    }

    // Check cooldown: no re-trigger within 2 hours of last dismissal
    const twoHoursAgo = subHours(now, 2);
    const recentDismissal = await prisma.suggestionFeedback.findFirst({
      where: {
        userId,
        action: 'dismissed',
        createdAt: { gte: twoHoursAgo },
        suggestion: {
          destAddress: pattern.destAddress,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentDismissal) {
      continue; // Cooldown active
    }

    const todayStart = startOfDay(now);

    // Check if already confirmed a suggestion today
    const existingConfirmation = await prisma.suggestion.findFirst({
      where: {
        userId,
        status: 'confirmed',
        destAddress: pattern.destAddress,
        createdAt: { gte: todayStart },
      },
    });

    if (existingConfirmation) {
      continue;
    }

    // Check if user already took a ride to this destination today (from actual history)
    const alreadyRodeToday = await prisma.rideHistory.findFirst({
      where: {
        userId,
        destAddress: pattern.destAddress,
        departureTime: { gte: todayStart },
      },
    });

    if (alreadyRodeToday) {
      continue; // User already completed this trip today
    }

    // Check consecutive dismissals — reduce effective confidence
    if (pattern.consecutiveDismissals >= 3) {
      const adjustedConfidence = pattern.confidence * (1 - pattern.consecutiveDismissals * 0.1);
      if (adjustedConfidence < 0.5) {
        continue; // Too many dismissals, pattern confidence too low
      }
    }

    // Check if there's already a pending suggestion for this pattern today
    const existingPending = await prisma.suggestion.findFirst({
      where: {
        userId,
        status: 'pending',
        destAddress: pattern.destAddress,
        createdAt: { gte: todayStart },
      },
    });

    if (existingPending) {
      // Return the existing pending suggestion's pattern
      return {
        shouldTrigger: true,
        pattern: {
          id: pattern.id,
          dayOfWeek: pattern.dayOfWeek,
          hourOfDay: pattern.hourOfDay,
          originAddress: pattern.originAddress,
          originLat: pattern.originLat,
          originLng: pattern.originLng,
          destAddress: pattern.destAddress,
          destLat: pattern.destLat,
          destLng: pattern.destLng,
          confidence: pattern.confidence,
          preferredPlatform: pattern.preferredPlatform,
          preferredRideType: pattern.preferredRideType,
        },
        reason: 'Existing pending suggestion found',
      };
    }

    // All checks passed — trigger!
    return {
      shouldTrigger: true,
      pattern: {
        id: pattern.id,
        dayOfWeek: pattern.dayOfWeek,
        hourOfDay: pattern.hourOfDay,
        originAddress: pattern.originAddress,
        originLat: pattern.originLat,
        originLng: pattern.originLng,
        destAddress: pattern.destAddress,
        destLat: pattern.destLat,
        destLng: pattern.destLng,
        confidence: pattern.confidence,
        preferredPlatform: pattern.preferredPlatform,
        preferredRideType: pattern.preferredRideType,
      },
      reason: `Pattern match: ${pattern.destAddress} at ${pattern.hourOfDay}:00 (confidence: ${(pattern.confidence * 100).toFixed(0)}%)`,
    };
  }

  // No time-matched patterns triggered; show the best upcoming pattern as a preview
  const upcomingPattern = patterns.find((p: typeof patterns[number]) => {
    const patternMinuteOfDay = p.hourOfDay * 60;
    const currentMinuteOfDay = currentHour * 60 + currentMinutes;
    return patternMinuteOfDay > currentMinuteOfDay;
  }) || patterns[0];

  if (upcomingPattern) {
    return {
      shouldTrigger: true,
      pattern: {
        id: upcomingPattern.id,
        dayOfWeek: upcomingPattern.dayOfWeek,
        hourOfDay: upcomingPattern.hourOfDay,
        originAddress: upcomingPattern.originAddress,
        originLat: upcomingPattern.originLat,
        originLng: upcomingPattern.originLng,
        destAddress: upcomingPattern.destAddress,
        destLat: upcomingPattern.destLat,
        destLng: upcomingPattern.destLng,
        confidence: upcomingPattern.confidence,
        preferredPlatform: upcomingPattern.preferredPlatform,
        preferredRideType: upcomingPattern.preferredRideType,
      },
      reason: `Preview: upcoming ride to ${upcomingPattern.destAddress} at ${upcomingPattern.hourOfDay}:00`,
    };
  }

  return {
    shouldTrigger: false,
    pattern: null,
    reason: 'No patterns triggered (all filtered by cooldown, confirmation, or time window)',
  };
}

/**
 * Record a dismissal and update the pattern's consecutive dismissal count.
 */
export async function recordDismissal(userId: string, patternId: string) {
  await prisma.locationPattern.update({
    where: { id: patternId },
    data: {
      consecutiveDismissals: { increment: 1 },
      lastTriggered: new Date(),
    },
  });
}

/**
 * Record a confirmation and reset the consecutive dismissal count.
 */
export async function recordConfirmation(userId: string, patternId: string) {
  await prisma.locationPattern.update({
    where: { id: patternId },
    data: {
      consecutiveDismissals: 0,
      lastTriggered: new Date(),
    },
  });
}
