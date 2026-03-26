import { prisma } from './prisma';
import { getDay, getHours, subHours, startOfDay } from 'date-fns';

interface FoodTriggerResult {
  shouldTrigger: boolean;
  pattern: {
    id: string;
    dayOfWeek: number;
    hourOfDay: number;
    cuisine: string;
    restaurantName: string;
    typicalItems: Array<{ name: string; frequency: number }>;
    confidence: number;
    averageCost: number;
    preferredPlatform: string | null;
  } | null;
  reason: string;
}

/**
 * The food trigger engine decides WHEN to surface a proactive food suggestion.
 *
 * Signals watched:
 * - Time of day vs learned patterns (±30 min window)
 * - Day of week vs learned patterns
 * - Confidence threshold (minimum 0.35)
 *
 * Anti-annoyance measures:
 * - 2-hour cooldown after dismissal
 * - Skip if already confirmed an order for this pattern today
 * - Reduce confidence after 3+ consecutive dismissals
 */
export async function evaluateFoodTriggers(userId: string): Promise<FoodTriggerResult> {
  const now = new Date();
  const currentDay = getDay(now);
  const currentHour = getHours(now);
  const currentMinutes = now.getMinutes();

  const todayPatterns = await prisma.foodPattern.findMany({
    where: {
      userId,
      dayOfWeek: currentDay,
      confidence: { gte: 0.35 },
    },
    orderBy: { confidence: 'desc' },
  });

  // If there are no confident patterns for today, fall back to the best upcoming
  // pattern from any weekday so the assistant still provides value.
  if (todayPatterns.length === 0) {
    const fallbackPatterns = await prisma.foodPattern.findMany({
      where: {
        userId,
        confidence: { gte: 0.2 },
      },
      orderBy: { confidence: 'desc' },
    });

    type FallbackPattern = (typeof fallbackPatterns)[number];
    const currentMinuteOfDay = currentHour * 60 + currentMinutes;
    type ScoredPattern = { p: FallbackPattern; deltaMinutes: number };
    const scored: ScoredPattern[] = fallbackPatterns.map((p: FallbackPattern) => {
      const patternMinuteOfDay = p.hourOfDay * 60;
      const dayDelta = (p.dayOfWeek - currentDay + 7) % 7;
      let deltaMinutes = dayDelta * 1440 + (patternMinuteOfDay - currentMinuteOfDay);
      if (deltaMinutes <= 0) deltaMinutes += 7 * 1440; // next week occurrence
      return { p, deltaMinutes };
    });

    scored.sort((a: ScoredPattern, b: ScoredPattern) => a.deltaMinutes - b.deltaMinutes);
    const upcomingPattern = scored[0]?.p;

    if (upcomingPattern) {
      const typicalItems =
        (upcomingPattern.typicalItems as Array<{ name: string; frequency: number }>) || [];
      return {
        shouldTrigger: true,
        pattern: {
          id: upcomingPattern.id,
          dayOfWeek: upcomingPattern.dayOfWeek,
          hourOfDay: upcomingPattern.hourOfDay,
          cuisine: upcomingPattern.cuisine,
          restaurantName: upcomingPattern.restaurantName,
          typicalItems,
          confidence: upcomingPattern.confidence,
          averageCost: upcomingPattern.averageCost,
          preferredPlatform: upcomingPattern.preferredPlatform,
        },
        reason: `Preview: upcoming order from ${upcomingPattern.restaurantName} at ${upcomingPattern.hourOfDay}:00`,
      };
    }

    return { shouldTrigger: false, pattern: null, reason: 'No food patterns found' };
  }

  const patterns = todayPatterns;

  for (const pattern of patterns) {
    const patternMinuteOfDay = pattern.hourOfDay * 60;
    const currentMinuteOfDay = currentHour * 60 + currentMinutes;
    const timeDiff = Math.abs(currentMinuteOfDay - patternMinuteOfDay);

    if (timeDiff > 30) continue;

    // 2-hour cooldown after dismissal
    const twoHoursAgo = subHours(now, 2);
    const recentDismissal = await prisma.foodSuggestionFeedback.findFirst({
      where: {
        userId,
        action: 'dismissed',
        createdAt: { gte: twoHoursAgo },
        suggestion: {
          restaurantName: pattern.restaurantName,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentDismissal) continue;

    const todayStart = startOfDay(now);

    // Skip if already confirmed a suggestion today
    const existingConfirmation = await prisma.foodSuggestion.findFirst({
      where: {
        userId,
        status: 'confirmed',
        createdAt: { gte: todayStart },
      },
    });

    if (existingConfirmation) continue;

    // Skip only if user already placed an order earlier today.
    // Seed data may include later timestamps on the same date; those should not block suggestions now.
    const alreadyOrderedToday = await prisma.foodOrderHistory.findFirst({
      where: {
        userId,
        orderTime: { gte: todayStart, lte: now },
      },
    });

    if (alreadyOrderedToday) continue;

    // Consecutive dismissals dampening
    if (pattern.consecutiveDismissals >= 3) {
      const adjustedConfidence = pattern.confidence * (1 - pattern.consecutiveDismissals * 0.1);
      if (adjustedConfidence < 0.35) continue;
    }

    // Check for existing pending suggestion
    const existingPending = await prisma.foodSuggestion.findFirst({
      where: {
        userId,
        status: 'pending',
        restaurantName: pattern.restaurantName,
        createdAt: { gte: todayStart },
      },
    });

    const typicalItems = (pattern.typicalItems as Array<{ name: string; frequency: number }>) || [];

    if (existingPending) {
      return {
        shouldTrigger: true,
        pattern: {
          id: pattern.id,
          dayOfWeek: pattern.dayOfWeek,
          hourOfDay: pattern.hourOfDay,
          cuisine: pattern.cuisine,
          restaurantName: pattern.restaurantName,
          typicalItems,
          confidence: pattern.confidence,
          averageCost: pattern.averageCost,
          preferredPlatform: pattern.preferredPlatform,
        },
        reason: 'Existing pending food suggestion found',
      };
    }

    return {
      shouldTrigger: true,
      pattern: {
        id: pattern.id,
        dayOfWeek: pattern.dayOfWeek,
        hourOfDay: pattern.hourOfDay,
        cuisine: pattern.cuisine,
        restaurantName: pattern.restaurantName,
        typicalItems,
        confidence: pattern.confidence,
        averageCost: pattern.averageCost,
        preferredPlatform: pattern.preferredPlatform,
      },
      reason: `Pattern match: ${pattern.restaurantName} (${pattern.cuisine}) at ${pattern.hourOfDay}:00 (confidence: ${(pattern.confidence * 100).toFixed(0)}%)`,
    };
  }

  // No time-matched patterns triggered; show the best upcoming pattern as a preview
  const upcomingPattern = patterns.find((p: typeof patterns[number]) => {
    const patternMinuteOfDay = p.hourOfDay * 60;
    const currentMinuteOfDay = currentHour * 60 + currentMinutes;
    return patternMinuteOfDay > currentMinuteOfDay;
  }) || patterns[0];

  if (upcomingPattern) {
    const typicalItems = (upcomingPattern.typicalItems as Array<{ name: string; frequency: number }>) || [];
    return {
      shouldTrigger: true,
      pattern: {
        id: upcomingPattern.id,
        dayOfWeek: upcomingPattern.dayOfWeek,
        hourOfDay: upcomingPattern.hourOfDay,
        cuisine: upcomingPattern.cuisine,
        restaurantName: upcomingPattern.restaurantName,
        typicalItems,
        confidence: upcomingPattern.confidence,
        averageCost: upcomingPattern.averageCost,
        preferredPlatform: upcomingPattern.preferredPlatform,
      },
      reason: `Preview: upcoming order from ${upcomingPattern.restaurantName} at ${upcomingPattern.hourOfDay}:00`,
    };
  }

  return {
    shouldTrigger: false,
    pattern: null,
    reason: 'No food patterns triggered (all filtered by cooldown, confirmation, or time window)',
  };
}

export async function recordFoodDismissal(_userId: string, patternId: string) {
  await prisma.foodPattern.update({
    where: { id: patternId },
    data: {
      consecutiveDismissals: { increment: 1 },
      lastTriggered: new Date(),
    },
  });
}

export async function recordFoodConfirmation(_userId: string, patternId: string) {
  await prisma.foodPattern.update({
    where: { id: patternId },
    data: {
      consecutiveDismissals: 0,
      lastTriggered: new Date(),
    },
  });
}
