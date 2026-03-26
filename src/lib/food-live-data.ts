/**
 * Live food data integration layer.
 * Tries REAL Zomato scraper first, then falls back to simulated data.
 * Swiggy data is always simulated (Zomato is the required platform integration).
 */

import {
  searchRestaurants as zomatoSearch,
  type ZomatoRestaurant,
} from './scrapers/zomato-scraper';

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
  dataSource: {
    zomato: 'live' | 'simulated' | 'error';
    swiggy: 'simulated';
  };
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

const SCRAPER_ENABLED = process.env.SCRAPER_ENABLED !== 'false';

/**
 * Fetch live restaurant data from all platforms.
 * Zomato: tries real scraper first, falls back to simulated.
 * Swiggy: always simulated (only Zomato is required by the assignment).
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
  let zomatoSource: 'live' | 'simulated' | 'error' = 'simulated';

  // --- Swiggy: always simulated ---
  try {
    const swiggyQuotes = await fetchSimulatedPlatformRestaurants(
      'swiggy', hour, delivery.extraDelayMinutes, surge, cuisine, restaurantName
    );
    restaurants.push(...swiggyQuotes);
  } catch {
    errors.push('Swiggy: Service temporarily unavailable');
  }

  // --- Zomato: try REAL scraper, fall back to simulated ---
  if (SCRAPER_ENABLED) {
    try {
      const zomatoQuotes = await fetchRealZomatoData(cuisine, restaurantName, hour, delivery, surge);
      if (zomatoQuotes.length > 0) {
        restaurants.push(...zomatoQuotes);
        zomatoSource = 'live';
        console.log(`[Food Live Data] Zomato: ${zomatoQuotes.length} restaurants from REAL scraper`);
      } else {
        throw new Error('Real scraper returned no restaurants');
      }
    } catch (e) {
      console.warn(`[Food Live Data] Zomato scraper failed, falling back to simulated:`, (e as Error).message);
      zomatoSource = 'simulated';
      try {
        const simQuotes = await fetchSimulatedPlatformRestaurants(
          'zomato', hour, delivery.extraDelayMinutes, surge, cuisine, restaurantName
        );
        restaurants.push(...simQuotes);
      } catch {
        zomatoSource = 'error';
        errors.push('Zomato: Service temporarily unavailable');
      }
    }
  } else {
    try {
      const simQuotes = await fetchSimulatedPlatformRestaurants(
        'zomato', hour, delivery.extraDelayMinutes, surge, cuisine, restaurantName
      );
      restaurants.push(...simQuotes);
    } catch {
      errors.push('Zomato: Service temporarily unavailable');
    }
  }

  return {
    restaurants,
    deliveryCondition: delivery.condition,
    extraDelayMinutes: delivery.extraDelayMinutes,
    fetchedAt: now,
    errors,
    dataSource: {
      zomato: zomatoSource,
      swiggy: 'simulated',
    },
  };
}

/**
 * Fetch REAL restaurant data from Zomato via HTTP scraping.
 * Uses Zomato's webroutes/getPage API to get real restaurant listings
 * with actual names, ratings, delivery times, and prices.
 */
async function fetchRealZomatoData(
  cuisine: string | undefined,
  restaurantName: string | undefined,
  hour: number,
  delivery: { condition: string; extraDelayMinutes: number },
  surge: { active: boolean; multiplier: number }
): Promise<RestaurantQuote[]> {
  const query = restaurantName || cuisine || 'restaurant';
  const city = process.env.ZOMATO_CITY || 'bangalore';
  const entityId = parseInt(process.env.ZOMATO_ENTITY_ID || '4', 10);

  const searchResults = await zomatoSearch(query, city, entityId, 6);
  if (searchResults.length === 0) {
    throw new Error('No restaurants found on Zomato');
  }

  return searchResults.slice(0, 5).map((restaurant) =>
    convertZomatoToQuote(restaurant, hour, delivery, surge)
  );
}

/**
 * Converts a real Zomato restaurant result into our RestaurantQuote format.
 * Menu items are generated from the cost-for-one data since Zomato's menu
 * API requires authentication. The restaurant info (name, rating, delivery
 * time, etc.) is all real scraped data.
 */
function convertZomatoToQuote(
  restaurant: ZomatoRestaurant,
  _hour: number,
  delivery: { condition: string; extraDelayMinutes: number },
  surge: { active: boolean; multiplier: number }
): RestaurantQuote {
  const baseDeliveryFee = Math.round(restaurant.costForOne * 0.08) || 25;
  const deliveryFee = surge.active
    ? Math.round(baseDeliveryFee * surge.multiplier)
    : baseDeliveryFee;

  // Generate representative menu items from cost data
  // (Zomato's menu API requires auth so we estimate from cost-for-one)
  const costPerItem = restaurant.costForOne || 250;
  const menu: MenuItem[] = generateMenuFromCost(
    restaurant.cuisines,
    costPerItem,
    surge
  );

  return {
    platform: 'zomato',
    platformDisplayName: 'Zomato',
    restaurantName: restaurant.name,
    cuisine: restaurant.cuisines[0]?.toLowerCase() || 'restaurant',
    rating: restaurant.deliveryRating || restaurant.aggregateRating,
    deliveryTimeMin: Math.max(15, restaurant.deliveryTimeMin + delivery.extraDelayMinutes),
    deliveryFee,
    deliveryFeeDisplay: deliveryFee === 0 ? 'FREE' : `₹${deliveryFee}`,
    minimumOrder: Math.round(restaurant.costForOne * 0.4) || 99,
    surgeActive: surge.active,
    surgeMultiplier: surge.multiplier,
    available: restaurant.isServiceable && restaurant.isOpen,
    menu,
  };
}

function generateMenuFromCost(
  cuisines: string[],
  avgCost: number,
  surge: { active: boolean; multiplier: number }
): MenuItem[] {
  const cuisineLower = cuisines.map(c => c.toLowerCase()).join(' ');
  let items: { name: string; priceFactor: number; isVeg: boolean; isBestseller: boolean }[];

  if (cuisineLower.includes('biryani') || cuisineLower.includes('andhra')) {
    items = [
      { name: 'Chicken Biryani', priceFactor: 1.0, isVeg: false, isBestseller: true },
      { name: 'Mutton Biryani', priceFactor: 1.4, isVeg: false, isBestseller: true },
      { name: 'Veg Biryani', priceFactor: 0.7, isVeg: true, isBestseller: false },
      { name: 'Chicken 65', priceFactor: 0.8, isVeg: false, isBestseller: false },
    ];
  } else if (cuisineLower.includes('chinese') || cuisineLower.includes('asian')) {
    items = [
      { name: 'Fried Rice', priceFactor: 0.7, isVeg: true, isBestseller: true },
      { name: 'Hakka Noodles', priceFactor: 0.7, isVeg: true, isBestseller: true },
      { name: 'Manchurian', priceFactor: 0.65, isVeg: true, isBestseller: false },
      { name: 'Chilli Chicken', priceFactor: 0.9, isVeg: false, isBestseller: false },
    ];
  } else if (cuisineLower.includes('pizza') || cuisineLower.includes('italian')) {
    items = [
      { name: 'Margherita Pizza', priceFactor: 0.6, isVeg: true, isBestseller: true },
      { name: 'Pepperoni Pizza', priceFactor: 1.0, isVeg: false, isBestseller: true },
      { name: 'Garlic Bread', priceFactor: 0.35, isVeg: true, isBestseller: false },
      { name: 'Pasta Alfredo', priceFactor: 0.85, isVeg: true, isBestseller: false },
    ];
  } else if (cuisineLower.includes('north indian')) {
    items = [
      { name: 'Butter Chicken', priceFactor: 1.0, isVeg: false, isBestseller: true },
      { name: 'Dal Makhani', priceFactor: 0.7, isVeg: true, isBestseller: true },
      { name: 'Butter Naan', priceFactor: 0.2, isVeg: true, isBestseller: false },
      { name: 'Paneer Tikka', priceFactor: 0.85, isVeg: true, isBestseller: false },
    ];
  } else {
    items = [
      { name: 'Special Combo', priceFactor: 1.0, isVeg: false, isBestseller: true },
      { name: 'Veg Thali', priceFactor: 0.7, isVeg: true, isBestseller: true },
      { name: 'Starter Platter', priceFactor: 0.6, isVeg: false, isBestseller: false },
      { name: 'Dessert', priceFactor: 0.35, isVeg: true, isBestseller: false },
    ];
  }

  return items.map(item => {
    const basePrice = Math.round(avgCost * item.priceFactor);
    const price = surge.active ? Math.round(basePrice * surge.multiplier) : basePrice;
    return {
      name: item.name,
      price,
      priceDisplay: `₹${price}`,
      available: true,
      isVeg: item.isVeg,
      isBestseller: item.isBestseller,
    };
  });
}

async function fetchSimulatedPlatformRestaurants(
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
