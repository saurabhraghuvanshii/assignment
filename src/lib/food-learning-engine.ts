import { prisma } from './prisma';
import { subDays, getHours } from 'date-fns';

interface FoodPatternData {
  dayOfWeek: number;
  hourOfDay: number;
  cuisine: string;
  restaurantName: string;
  items: Record<string, number>; // item name -> weighted count
  count: number;
  recentCount: number;
  totalCost: number;
  platforms: Record<string, number>;
}

/**
 * Analyzes food order history and extracts behavioral patterns.
 * Uses frequency analysis with recency decay to identify
 * what and when the user typically orders.
 */
export async function analyzeFoodPatterns(userId: string) {
  const orders = await prisma.foodOrderHistory.findMany({
    where: { userId },
    orderBy: { orderTime: 'desc' },
  });

  if (orders.length === 0) return [];

  const thirtyDaysAgo = subDays(new Date(), 30);
  const patternMap = new Map<string, FoodPatternData>();

  for (const order of orders) {
    const dayOfWeek = order.dayOfWeek;
    const hourOfDay = getHours(order.orderTime);
    const key = `${dayOfWeek}-${hourOfDay}-${order.restaurantName}`;

    const isRecent = order.orderTime >= thirtyDaysAgo;

    if (!patternMap.has(key)) {
      patternMap.set(key, {
        dayOfWeek,
        hourOfDay,
        cuisine: order.cuisine,
        restaurantName: order.restaurantName,
        items: {},
        count: 0,
        recentCount: 0,
        totalCost: 0,
        platforms: {},
      });
    }

    const pattern = patternMap.get(key)!;
    pattern.count += isRecent ? 2 : 1;
    if (isRecent) pattern.recentCount++;
    pattern.totalCost += order.totalCost;

    pattern.platforms[order.platform] = (pattern.platforms[order.platform] || 0) + (isRecent ? 2 : 1);

    const items = order.items as Array<{ name: string; quantity?: number }>;
    if (Array.isArray(items)) {
      for (const item of items) {
        const qty = item.quantity || 1;
        pattern.items[item.name] = (pattern.items[item.name] || 0) + qty * (isRecent ? 2 : 1);
      }
    }
  }

  const patterns = Array.from(patternMap.values()).map((p) => {
    const maxPossible = 13 * 2; // ~13 weeks, 2x recency weight
    const rawConfidence = Math.min(p.count / maxPossible, 1);
    const recencyBoost = p.recentCount > 0 ? 0.1 : -0.1;
    const confidence = Math.max(0, Math.min(1, rawConfidence + recencyBoost));

    const preferredPlatform = Object.entries(p.platforms).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const typicalItems = Object.entries(p.items)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, frequency]) => ({ name, frequency }));

    const effectiveCount = Math.ceil(p.count / 2);
    const averageCost = p.totalCost / effectiveCount;

    return {
      dayOfWeek: p.dayOfWeek,
      hourOfDay: p.hourOfDay,
      cuisine: p.cuisine,
      restaurantName: p.restaurantName,
      typicalItems,
      confidence,
      frequency: effectiveCount,
      averageCost: Math.round(averageCost),
      preferredPlatform,
    };
  });

  return patterns.filter((p) => p.confidence > 0.3).sort((a, b) => b.confidence - a.confidence);
}

/**
 * Applies feedback from user edits to adjust food pattern confidence.
 */
async function applyFoodFeedbackToPatterns(userId: string) {
  const recentFeedback = await prisma.foodSuggestionFeedback.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { suggestion: true },
  });

  for (const fb of recentFeedback) {
    if (fb.action === 'edited' && fb.editedFields) {
      const fields = fb.editedFields as Record<string, unknown>;
      if (fields.restaurant && fb.suggestion) {
        // User changed restaurant — penalize the original
        await prisma.foodPattern.updateMany({
          where: { userId, restaurantName: fb.suggestion.restaurantName },
          data: { confidence: { decrement: 0.02 } },
        });
      }
      if (fields.platform && fb.suggestion?.patternId) {
        await prisma.foodPattern.updateMany({
          where: { id: fb.suggestion.patternId },
          data: { preferredPlatform: fields.platform as string },
        });
      }
    }
  }
}

/**
 * Persists learned food patterns to the database, updating existing ones.
 * Also incorporates user feedback (edits, dismissals) into pattern weights.
 */
export async function updateStoredFoodPatterns(userId: string) {
  const patterns = await analyzeFoodPatterns(userId);

  for (const pattern of patterns) {
    await prisma.foodPattern.upsert({
      where: {
        userId_dayOfWeek_hourOfDay_restaurantName: {
          userId,
          dayOfWeek: pattern.dayOfWeek,
          hourOfDay: pattern.hourOfDay,
          restaurantName: pattern.restaurantName,
        },
      },
      update: {
        confidence: pattern.confidence,
        frequency: pattern.frequency,
        averageCost: pattern.averageCost,
        preferredPlatform: pattern.preferredPlatform,
        typicalItems: pattern.typicalItems,
        cuisine: pattern.cuisine,
      },
      create: {
        userId,
        ...pattern,
      },
    });
  }

  await applyFoodFeedbackToPatterns(userId);

  return patterns;
}
