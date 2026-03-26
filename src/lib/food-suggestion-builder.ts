import { prisma } from './prisma';
import { fetchFoodLiveData, FoodLiveDataResult, RestaurantQuote } from './food-live-data';
import { format } from 'date-fns';

export interface FoodSuggestionResult {
  id: string;
  status: string;
  patternId: string | null;
  platform: string;
  restaurantName: string;
  items: Array<{ name: string; price: number; quantity: number }>;
  cuisine: string;
  estimatedCost: number;
  estimatedDeliveryMin: number;
  explanation: string;
  liveData: FoodLiveDataResult;
  alternatives: AlternativeRestaurant[];
  confidence: number;
}

interface AlternativeRestaurant {
  platform: string;
  platformDisplayName: string;
  restaurantName: string;
  cuisine: string;
  rating: number;
  deliveryTimeMin: number;
  estimatedCost: number;
  deliveryFee: number;
  deliveryFeeDisplay: string;
  available: boolean;
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Builds a complete food suggestion from a detected pattern.
 * Fetches live data, picks items, and generates alternatives.
 */
export async function buildFoodSuggestion(
  userId: string,
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
  }
): Promise<FoodSuggestionResult> {
  const liveData = await fetchFoodLiveData(pattern.cuisine, pattern.restaurantName);

  // Find the best matching restaurant from live data
  let primaryRestaurant: RestaurantQuote | null = null;

  // Prefer the exact restaurant the user usually orders from
  primaryRestaurant = liveData.restaurants.find(
    (r) => r.restaurantName === pattern.restaurantName && r.available
  ) || null;

  // If preferred restaurant unavailable, find a similar one
  if (!primaryRestaurant) {
    primaryRestaurant = liveData.restaurants.find(
      (r) => r.cuisine === pattern.cuisine && r.available
    ) || null;
  }

  // Fallback to any available restaurant
  if (!primaryRestaurant) {
    primaryRestaurant = liveData.restaurants.find((r) => r.available) || null;
  }

  // Pick items based on user's typical orders matched against live menu
  const suggestedItems = pickItems(pattern.typicalItems, primaryRestaurant);
  const estimatedCost = suggestedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const platform = primaryRestaurant?.platform || pattern.preferredPlatform || 'swiggy';
  const restaurantName = primaryRestaurant?.restaurantName || pattern.restaurantName;
  const deliveryTime = primaryRestaurant?.deliveryTimeMin || 35;

  // Build alternatives
  const alternatives = buildAlternatives(liveData, restaurantName, pattern.cuisine);

  const explanation = buildFoodExplanation(pattern, liveData, primaryRestaurant);

  // Check for existing pending suggestion
  const now = new Date();
  const existingSuggestion = await prisma.foodSuggestion.findFirst({
    where: {
      userId,
      status: 'pending',
      restaurantName,
      createdAt: {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      },
    },
  });

  if (existingSuggestion) {
    const updated = await prisma.foodSuggestion.update({
      where: { id: existingSuggestion.id },
      data: {
        estimatedCost,
        estimatedDeliveryMin: deliveryTime,
        explanation,
        platformData: JSON.parse(JSON.stringify(liveData)),
        alternatives: JSON.parse(JSON.stringify(alternatives)),
        items: suggestedItems,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      patternId: pattern.id,
      platform,
      restaurantName,
      items: suggestedItems,
      cuisine: pattern.cuisine,
      estimatedCost,
      estimatedDeliveryMin: deliveryTime,
      explanation,
      liveData,
      alternatives,
      confidence: pattern.confidence,
    };
  }

  const suggestion = await prisma.foodSuggestion.create({
    data: {
      userId,
      patternId: pattern.id,
      platform,
      restaurantName,
      items: suggestedItems,
      cuisine: pattern.cuisine,
      estimatedCost,
      estimatedDeliveryMin: deliveryTime,
      explanation,
      platformData: JSON.parse(JSON.stringify(liveData)),
      alternatives: JSON.parse(JSON.stringify(alternatives)),
    },
  });

  return {
    id: suggestion.id,
    status: suggestion.status,
    patternId: pattern.id,
    platform,
    restaurantName,
    items: suggestedItems,
    cuisine: pattern.cuisine,
    estimatedCost,
    estimatedDeliveryMin: deliveryTime,
    explanation,
    liveData,
    alternatives,
    confidence: pattern.confidence,
  };
}

function pickItems(
  typicalItems: Array<{ name: string; frequency: number }>,
  restaurant: RestaurantQuote | null
): Array<{ name: string; price: number; quantity: number }> {
  if (!restaurant || !restaurant.menu.length) {
    // Fallback: return typical items with estimated prices
    return typicalItems.slice(0, 3).map((item) => ({
      name: item.name,
      price: 250,
      quantity: 1,
    }));
  }

  const result: Array<{ name: string; price: number; quantity: number }> = [];
  const menuByName = new Map(restaurant.menu.map((m) => [m.name.toLowerCase(), m]));

  // Try to match typical items against the menu
  for (const typical of typicalItems) {
    const menuItem = menuByName.get(typical.name.toLowerCase());
    if (menuItem && menuItem.available) {
      result.push({ name: menuItem.name, price: menuItem.price, quantity: 1 });
    }
  }

  // If no matches, pick bestsellers
  if (result.length === 0) {
    const bestsellers = restaurant.menu.filter((m) => m.isBestseller && m.available);
    for (const item of bestsellers.slice(0, 2)) {
      result.push({ name: item.name, price: item.price, quantity: 1 });
    }
  }

  // Ensure at least one item
  if (result.length === 0 && restaurant.menu.length > 0) {
    const available = restaurant.menu.find((m) => m.available);
    if (available) {
      result.push({ name: available.name, price: available.price, quantity: 1 });
    }
  }

  return result;
}

function buildAlternatives(
  liveData: FoodLiveDataResult,
  primaryRestaurant: string,
  cuisine: string
): AlternativeRestaurant[] {
  return liveData.restaurants
    .filter((r) => r.restaurantName !== primaryRestaurant && r.available)
    .sort((a, b) => {
      // Prefer same cuisine, then by rating
      const cuisineMatchA = a.cuisine === cuisine ? 1 : 0;
      const cuisineMatchB = b.cuisine === cuisine ? 1 : 0;
      if (cuisineMatchA !== cuisineMatchB) return cuisineMatchB - cuisineMatchA;
      return b.rating - a.rating;
    })
    .slice(0, 4)
    .map((r) => {
      const avgItemPrice = r.menu.filter((m) => m.available).reduce((s, m) => s + m.price, 0)
        / Math.max(r.menu.filter((m) => m.available).length, 1);
      return {
        platform: r.platform,
        platformDisplayName: r.platformDisplayName,
        restaurantName: r.restaurantName,
        cuisine: r.cuisine,
        rating: r.rating,
        deliveryTimeMin: r.deliveryTimeMin,
        estimatedCost: Math.round(avgItemPrice * 1.5),
        deliveryFee: r.deliveryFee,
        deliveryFeeDisplay: r.deliveryFeeDisplay,
        available: r.available,
      };
    });
}

function buildFoodExplanation(
  pattern: {
    hourOfDay: number;
    dayOfWeek: number;
    cuisine: string;
    restaurantName: string;
    confidence: number;
  },
  liveData: FoodLiveDataResult,
  restaurant: RestaurantQuote | null
): string {
  const dayName = dayNames[pattern.dayOfWeek];
  const timeStr = format(
    new Date(2000, 0, 1, pattern.hourOfDay, 0),
    'h:mm a'
  );

  let explanation = `You usually order ${pattern.cuisine} from ${pattern.restaurantName} around ${timeStr} on ${dayName}s`;

  if (liveData.deliveryCondition === 'very_busy' || liveData.deliveryCondition === 'extreme') {
    explanation += `. Delivery times are ${liveData.extraDelayMinutes} min longer than usual — ordering now is recommended`;
  } else if (liveData.deliveryCondition === 'busy') {
    explanation += `. Delivery demand is slightly above normal`;
  } else {
    explanation += `. Delivery times look good right now`;
  }

  if (restaurant && restaurant.surgeActive) {
    explanation += `. Surge pricing active (${restaurant.surgeMultiplier}×)`;
  }

  if (restaurant && !restaurant.available) {
    explanation += `. Note: ${pattern.restaurantName} is currently unavailable — showing alternative`;
  }

  return explanation;
}
