/**
 * Live food data integration layer.
 * Simulates fetching live data from Swiggy and Zomato.
 * Real scrapers/APIs can replace the simulation functions.
 */

export interface MenuItem {
  name: string;
  price: number;
  priceDisplay: string;
  available: boolean;
  isVeg: boolean;
  isBestseller: boolean;
}

export interface RestaurantQuote {
  platform: string;
  platformDisplayName: string;
  restaurantName: string;
  cuisine: string;
  rating: number;
  deliveryTimeMin: number;
  deliveryFee: number;
  deliveryFeeDisplay: string;
  minimumOrder: number;
  surgeActive: boolean;
  surgeMultiplier: number;
  available: boolean;
  menu: MenuItem[];
  error?: string;
}

export interface FoodLiveDataResult {
  restaurants: RestaurantQuote[];
  deliveryCondition: 'normal' | 'busy' | 'very_busy' | 'extreme';
  extraDelayMinutes: number;
  fetchedAt: Date;
  errors: string[];
}

const platformNames: Record<string, string> = {
  swiggy: 'Swiggy',
  zomato: 'Zomato',
};

interface RestaurantConfig {
  name: string;
  cuisine: string;
  rating: number;
  baseDeliveryTime: number;
  deliveryFee: number;
  minimumOrder: number;
  menu: { name: string; price: number; isVeg: boolean; isBestseller: boolean }[];
}

const restaurantCatalog: Record<string, RestaurantConfig[]> = {
  swiggy: [
    {
      name: 'Paradise Biryani',
      cuisine: 'biryani',
      rating: 4.3,
      baseDeliveryTime: 35,
      deliveryFee: 30,
      minimumOrder: 149,
      menu: [
        { name: 'Chicken Biryani', price: 299, isVeg: false, isBestseller: true },
        { name: 'Mutton Biryani', price: 399, isVeg: false, isBestseller: true },
        { name: 'Veg Biryani', price: 219, isVeg: true, isBestseller: false },
        { name: 'Chicken 65', price: 249, isVeg: false, isBestseller: false },
        { name: 'Raita', price: 49, isVeg: true, isBestseller: false },
      ],
    },
    {
      name: 'Bowl Company',
      cuisine: 'healthy',
      rating: 4.1,
      baseDeliveryTime: 25,
      deliveryFee: 20,
      minimumOrder: 99,
      menu: [
        { name: 'Quinoa Buddha Bowl', price: 269, isVeg: true, isBestseller: true },
        { name: 'Grilled Chicken Salad', price: 299, isVeg: false, isBestseller: true },
        { name: 'Protein Power Bowl', price: 329, isVeg: false, isBestseller: false },
        { name: 'Green Smoothie Bowl', price: 199, isVeg: true, isBestseller: false },
      ],
    },
    {
      name: 'Meghana Foods',
      cuisine: 'biryani',
      rating: 4.5,
      baseDeliveryTime: 40,
      deliveryFee: 40,
      minimumOrder: 199,
      menu: [
        { name: 'Chicken Dum Biryani', price: 329, isVeg: false, isBestseller: true },
        { name: 'Andhra Meals', price: 199, isVeg: true, isBestseller: true },
        { name: 'Mutton Biryani', price: 449, isVeg: false, isBestseller: false },
        { name: 'Chicken Kebab', price: 279, isVeg: false, isBestseller: false },
      ],
    },
    {
      name: 'Wok Express',
      cuisine: 'chinese',
      rating: 4.0,
      baseDeliveryTime: 30,
      deliveryFee: 25,
      minimumOrder: 149,
      menu: [
        { name: 'Hakka Noodles', price: 179, isVeg: true, isBestseller: true },
        { name: 'Chicken Fried Rice', price: 199, isVeg: false, isBestseller: true },
        { name: 'Manchurian', price: 169, isVeg: true, isBestseller: false },
        { name: 'Chilli Chicken', price: 229, isVeg: false, isBestseller: false },
      ],
    },
    {
      name: 'Subway',
      cuisine: 'healthy',
      rating: 3.9,
      baseDeliveryTime: 20,
      deliveryFee: 15,
      minimumOrder: 99,
      menu: [
        { name: 'Veggie Delite Sub', price: 189, isVeg: true, isBestseller: true },
        { name: 'Chicken Teriyaki Sub', price: 299, isVeg: false, isBestseller: true },
        { name: 'Paneer Tikka Sub', price: 249, isVeg: true, isBestseller: false },
        { name: 'Cookie', price: 49, isVeg: true, isBestseller: false },
      ],
    },
    {
      name: 'Truffles',
      cuisine: 'burgers',
      rating: 4.4,
      baseDeliveryTime: 35,
      deliveryFee: 35,
      minimumOrder: 149,
      menu: [
        { name: 'Classic Smash Burger', price: 259, isVeg: false, isBestseller: true },
        { name: 'Truffle Special Burger', price: 349, isVeg: false, isBestseller: true },
        { name: 'Cottage Cheese Burger', price: 229, isVeg: true, isBestseller: false },
        { name: 'Loaded Fries', price: 179, isVeg: true, isBestseller: false },
      ],
    },
  ],
  zomato: [
    {
      name: 'Behrouz Biryani',
      cuisine: 'biryani',
      rating: 4.2,
      baseDeliveryTime: 40,
      deliveryFee: 35,
      minimumOrder: 199,
      menu: [
        { name: 'Dum Gosht Biryani', price: 369, isVeg: false, isBestseller: true },
        { name: 'Murgh Makhani Biryani', price: 339, isVeg: false, isBestseller: true },
        { name: 'Subz-e-Biryani', price: 249, isVeg: true, isBestseller: false },
        { name: 'Kebab Platter', price: 299, isVeg: false, isBestseller: false },
      ],
    },
    {
      name: 'EatFit',
      cuisine: 'healthy',
      rating: 4.3,
      baseDeliveryTime: 25,
      deliveryFee: 0,
      minimumOrder: 99,
      menu: [
        { name: 'Ragi Dosa', price: 149, isVeg: true, isBestseller: true },
        { name: 'Grilled Chicken Wrap', price: 219, isVeg: false, isBestseller: true },
        { name: 'Oats Idli', price: 129, isVeg: true, isBestseller: false },
        { name: 'Multigrain Roti Thali', price: 179, isVeg: true, isBestseller: false },
      ],
    },
    {
      name: 'Empire Restaurant',
      cuisine: 'biryani',
      rating: 4.1,
      baseDeliveryTime: 35,
      deliveryFee: 25,
      minimumOrder: 149,
      menu: [
        { name: 'Empire Special Biryani', price: 280, isVeg: false, isBestseller: true },
        { name: 'Tandoori Chicken', price: 320, isVeg: false, isBestseller: true },
        { name: 'Paneer Butter Masala', price: 220, isVeg: true, isBestseller: false },
        { name: 'Butter Naan', price: 50, isVeg: true, isBestseller: false },
      ],
    },
    {
      name: 'Chinita Real Mexican Food',
      cuisine: 'mexican',
      rating: 4.4,
      baseDeliveryTime: 30,
      deliveryFee: 30,
      minimumOrder: 199,
      menu: [
        { name: 'Burrito Bowl', price: 349, isVeg: false, isBestseller: true },
        { name: 'Quesadilla', price: 279, isVeg: true, isBestseller: true },
        { name: 'Nachos Grande', price: 249, isVeg: true, isBestseller: false },
        { name: 'Churros', price: 149, isVeg: true, isBestseller: false },
      ],
    },
    {
      name: 'Dominos Pizza',
      cuisine: 'pizza',
      rating: 3.8,
      baseDeliveryTime: 30,
      deliveryFee: 0,
      minimumOrder: 99,
      menu: [
        { name: 'Farmhouse Pizza', price: 299, isVeg: true, isBestseller: true },
        { name: 'Chicken Dominator', price: 399, isVeg: false, isBestseller: true },
        { name: 'Margherita', price: 149, isVeg: true, isBestseller: false },
        { name: 'Garlic Breadsticks', price: 99, isVeg: true, isBestseller: false },
      ],
    },
  ],
};

function getDeliveryCondition(
  hour: number,
  dayOfWeek: number
): { condition: 'normal' | 'busy' | 'very_busy' | 'extreme'; extraDelayMinutes: number } {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  // Lunch rush: 12-2 PM
  if (hour >= 12 && hour <= 14) {
    const severity = Math.random();
    if (severity > 0.7) return { condition: 'very_busy', extraDelayMinutes: randomBetween(10, 20) };
    if (severity > 0.3) return { condition: 'busy', extraDelayMinutes: randomBetween(5, 12) };
    return { condition: 'normal', extraDelayMinutes: 0 };
  }

  // Dinner rush: 7-10 PM
  if (hour >= 19 && hour <= 22) {
    const severity = Math.random();
    if (isWeekday && (dayOfWeek === 5)) {
      // Friday evening is always busy
      if (severity > 0.4) return { condition: 'very_busy', extraDelayMinutes: randomBetween(12, 20) };
      return { condition: 'busy', extraDelayMinutes: randomBetween(8, 15) };
    }
    if (severity > 0.6) return { condition: 'very_busy', extraDelayMinutes: randomBetween(10, 18) };
    if (severity > 0.2) return { condition: 'busy', extraDelayMinutes: randomBetween(5, 12) };
    return { condition: 'normal', extraDelayMinutes: 0 };
  }

  if (Math.random() > 0.8) return { condition: 'busy', extraDelayMinutes: randomBetween(3, 8) };
  return { condition: 'normal', extraDelayMinutes: 0 };
}

function getSurge(hour: number): { active: boolean; multiplier: number } {
  const isPeakLunch = hour >= 12 && hour <= 14;
  const isPeakDinner = hour >= 19 && hour <= 22;

  if (!isPeakLunch && !isPeakDinner) return { active: false, multiplier: 1.0 };

  if (Math.random() > 0.6) {
    const mult = parseFloat((1.1 + Math.random() * 0.4).toFixed(1));
    return { active: true, multiplier: mult };
  }
  return { active: false, multiplier: 1.0 };
}

/**
 * Fetch live restaurant data from all platforms.
 * Handles failures gracefully — if a platform fails, others still return.
 */
export async function fetchFoodLiveData(
  cuisine?: string,
  restaurantName?: string
): Promise<FoodLiveDataResult> {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const delivery = getDeliveryCondition(hour, dayOfWeek);
  const surge = getSurge(hour);

  const restaurants: RestaurantQuote[] = [];
  const errors: string[] = [];

  for (const platform of ['swiggy', 'zomato']) {
    try {
      const platformRestaurants = await fetchPlatformRestaurants(
        platform,
        hour,
        delivery.extraDelayMinutes,
        surge,
        cuisine,
        restaurantName
      );
      restaurants.push(...platformRestaurants);
    } catch {
      const errorMsg = `${platformNames[platform]}: Service temporarily unavailable`;
      errors.push(errorMsg);
    }
  }

  return {
    restaurants,
    deliveryCondition: delivery.condition,
    extraDelayMinutes: delivery.extraDelayMinutes,
    fetchedAt: now,
    errors,
  };
}

async function fetchPlatformRestaurants(
  platform: string,
  hour: number,
  extraDelay: number,
  surge: { active: boolean; multiplier: number },
  filterCuisine?: string,
  filterRestaurant?: string
): Promise<RestaurantQuote[]> {
  // Simulate 5% failure rate
  if (Math.random() < 0.05) {
    throw new Error(`${platform} API timeout`);
  }

  const catalog = restaurantCatalog[platform] || [];
  const results: RestaurantQuote[] = [];

  for (const restaurant of catalog) {
    if (filterCuisine && restaurant.cuisine !== filterCuisine && filterCuisine !== restaurant.name) {
      // Still include if specifically requested by name
      if (filterRestaurant && restaurant.name !== filterRestaurant) continue;
      if (!filterRestaurant) continue;
    }

    // 10% chance any restaurant is temporarily unavailable
    const available = Math.random() > 0.1;

    const deliveryTime = restaurant.baseDeliveryTime + extraDelay + randomBetween(-3, 5);
    const deliveryFee = surge.active
      ? Math.round(restaurant.deliveryFee * surge.multiplier)
      : restaurant.deliveryFee;

    const menu: MenuItem[] = restaurant.menu.map((item) => ({
      name: item.name,
      price: surge.active ? Math.round(item.price * surge.multiplier) : item.price,
      priceDisplay: `₹${surge.active ? Math.round(item.price * surge.multiplier) : item.price}`,
      available: Math.random() > 0.05, // 5% chance an item is unavailable
      isVeg: item.isVeg,
      isBestseller: item.isBestseller,
    }));

    results.push({
      platform,
      platformDisplayName: platformNames[platform],
      restaurantName: restaurant.name,
      cuisine: restaurant.cuisine,
      rating: restaurant.rating,
      deliveryTimeMin: Math.max(15, deliveryTime),
      deliveryFee,
      deliveryFeeDisplay: deliveryFee === 0 ? 'FREE' : `₹${deliveryFee}`,
      minimumOrder: restaurant.minimumOrder,
      surgeActive: surge.active,
      surgeMultiplier: surge.multiplier,
      available,
      menu,
    });
  }

  return results;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
