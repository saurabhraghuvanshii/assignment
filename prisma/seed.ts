import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { subDays, setHours, setMinutes, addMinutes } from 'date-fns';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function addJitter(minutes: number, jitterRange: number): number {
  return minutes + randomBetween(-jitterRange, jitterRange);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Ride data ----

const locations = {
  home: { address: '123 Koramangala 4th Block, Bangalore', lat: 12.9352, lng: 77.6245 },
  office: { address: 'WeWork Galaxy, Residency Road, Bangalore', lat: 12.9716, lng: 77.6020 },
  gym: { address: 'Cult Fitness, HSR Layout, Bangalore', lat: 12.9116, lng: 77.6389 },
  mall: { address: 'Phoenix Marketcity, Whitefield, Bangalore', lat: 12.9976, lng: 77.6967 },
  restaurant: { address: 'Toit Brewpub, Indiranagar, Bangalore', lat: 12.9784, lng: 77.6408 },
  friend: { address: '45 JP Nagar 6th Phase, Bangalore', lat: 12.8997, lng: 77.5854 },
};

// ---- Food data ----

interface FoodOrderData {
  userId: string;
  platform: string;
  restaurantName: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  cuisine: string;
  totalCost: number;
  deliveryFee: number;
  orderTime: Date;
  deliveryDurationMinutes: number;
  dayOfWeek: number;
  rating: number | null;
}

const foodRestaurants = {
  biryani: [
    {
      name: 'Paradise Biryani',
      platform: 'swiggy',
      items: [
        { name: 'Chicken Biryani', price: 299 },
        { name: 'Mutton Biryani', price: 399 },
        { name: 'Raita', price: 49 },
      ],
    },
    {
      name: 'Meghana Foods',
      platform: 'swiggy',
      items: [
        { name: 'Chicken Dum Biryani', price: 329 },
        { name: 'Andhra Meals', price: 199 },
      ],
    },
    {
      name: 'Behrouz Biryani',
      platform: 'zomato',
      items: [
        { name: 'Dum Gosht Biryani', price: 369 },
        { name: 'Murgh Makhani Biryani', price: 339 },
      ],
    },
    {
      name: 'Empire Restaurant',
      platform: 'zomato',
      items: [
        { name: 'Empire Special Biryani', price: 280 },
        { name: 'Tandoori Chicken', price: 320 },
      ],
    },
  ],
  healthy: [
    {
      name: 'Bowl Company',
      platform: 'swiggy',
      items: [
        { name: 'Quinoa Buddha Bowl', price: 269 },
        { name: 'Grilled Chicken Salad', price: 299 },
      ],
    },
    {
      name: 'Subway',
      platform: 'swiggy',
      items: [
        { name: 'Veggie Delite Sub', price: 189 },
        { name: 'Chicken Teriyaki Sub', price: 299 },
      ],
    },
    {
      name: 'EatFit',
      platform: 'zomato',
      items: [
        { name: 'Ragi Dosa', price: 149 },
        { name: 'Grilled Chicken Wrap', price: 219 },
      ],
    },
  ],
  chinese: [
    {
      name: 'Wok Express',
      platform: 'swiggy',
      items: [
        { name: 'Hakka Noodles', price: 179 },
        { name: 'Chicken Fried Rice', price: 199 },
        { name: 'Chilli Chicken', price: 229 },
      ],
    },
  ],
  burgers: [
    {
      name: 'Truffles',
      platform: 'swiggy',
      items: [
        { name: 'Classic Smash Burger', price: 259 },
        { name: 'Truffle Special Burger', price: 349 },
        { name: 'Loaded Fries', price: 179 },
      ],
    },
  ],
  pizza: [
    {
      name: 'Dominos Pizza',
      platform: 'zomato',
      items: [
        { name: 'Farmhouse Pizza', price: 299 },
        { name: 'Chicken Dominator', price: 399 },
        { name: 'Garlic Breadsticks', price: 99 },
      ],
    },
  ],
};

async function main() {
  console.log('Seeding database...');

  // Clear all data
  await prisma.foodSuggestionFeedback.deleteMany();
  await prisma.foodSuggestion.deleteMany();
  await prisma.foodPattern.deleteMany();
  await prisma.foodOrderHistory.deleteMany();
  await prisma.suggestionFeedback.deleteMany();
  await prisma.suggestion.deleteMany();
  await prisma.locationPattern.deleteMany();
  await prisma.rideHistory.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: {
      name: 'Rahul Sharma',
      homeAddress: locations.home.address,
      homeLat: locations.home.lat,
      homeLng: locations.home.lng,
      workAddress: locations.office.address,
      workLat: locations.office.lat,
      workLng: locations.office.lng,
    },
  });
  console.log(`Created user: ${user.name} (${user.id})`);

  // ---- Generate ride history ----
  type RideData = {
    userId: string; platform: string; rideType: string;
    originAddress: string; originLat: number; originLng: number;
    destAddress: string; destLat: number; destLng: number;
    departureTime: Date; arrivalTime: Date; cost: number; distance: number; dayOfWeek: number;
  };
  const rides: RideData[] = [];

  for (let daysAgo = 90; daysAgo >= 0; daysAgo--) {
    const date = subDays(new Date(), daysAgo);
    const dayOfWeek = date.getDay();

    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      if (Math.random() < 0.85) {
        const depMin = addJitter(15, 10);
        const departure = setMinutes(setHours(date, 9), Math.max(0, Math.min(59, depMin)));
        const arrival = addMinutes(departure, randomBetween(25, 45));
        const r = Math.random();
        const [platform, rideType, cost] = r < 0.6
          ? ['uber', 'cab', randomBetween(180, 280)]
          : r < 0.8
            ? ['ola', 'cab', randomBetween(160, 260)]
            : ['rapido', 'auto', randomBetween(80, 140)];
        rides.push({
          userId: user.id, platform, rideType,
          originAddress: locations.home.address, originLat: locations.home.lat, originLng: locations.home.lng,
          destAddress: locations.office.address, destLat: locations.office.lat, destLng: locations.office.lng,
          departureTime: departure, arrivalTime: arrival, cost, distance: randomBetween(6, 9), dayOfWeek,
        });
      }
      if (Math.random() < 0.7) {
        const departure = setMinutes(setHours(date, 18), Math.max(0, Math.min(59, addJitter(30, 15))));
        const arrival = addMinutes(departure, randomBetween(30, 55));
        const r = Math.random();
        const [platform, rideType, cost] = r < 0.55
          ? ['uber', 'cab', randomBetween(200, 320)]
          : r < 0.8
            ? ['ola', 'cab', randomBetween(180, 300)]
            : ['rapido', 'auto', randomBetween(90, 150)];
        rides.push({
          userId: user.id, platform, rideType,
          originAddress: locations.office.address, originLat: locations.office.lat, originLng: locations.office.lng,
          destAddress: locations.home.address, destLat: locations.home.lat, destLng: locations.home.lng,
          departureTime: departure, arrivalTime: arrival, cost, distance: randomBetween(6, 9), dayOfWeek,
        });
      }
    }

    if (dayOfWeek === 6 && Math.random() < 0.75) {
      const departure = setMinutes(setHours(date, 8), Math.max(0, Math.min(59, addJitter(0, 10))));
      const arrival = addMinutes(departure, randomBetween(10, 20));
      rides.push({
        userId: user.id, platform: 'rapido', rideType: 'bike',
        originAddress: locations.home.address, originLat: locations.home.lat, originLng: locations.home.lng,
        destAddress: locations.gym.address, destLat: locations.gym.lat, destLng: locations.gym.lng,
        departureTime: departure, arrivalTime: arrival, cost: randomBetween(40, 70), distance: randomBetween(2, 4), dayOfWeek,
      });
    }

    if (dayOfWeek === 6 && Math.random() < 0.3) {
      const departure = setMinutes(setHours(date, 15), randomBetween(0, 30));
      const arrival = addMinutes(departure, randomBetween(25, 40));
      rides.push({
        userId: user.id, platform: 'uber', rideType: 'cab',
        originAddress: locations.home.address, originLat: locations.home.lat, originLng: locations.home.lng,
        destAddress: locations.mall.address, destLat: locations.mall.lat, destLng: locations.mall.lng,
        departureTime: departure, arrivalTime: arrival, cost: randomBetween(250, 400), distance: randomBetween(10, 15), dayOfWeek,
      });
    }

    if (dayOfWeek === 0 && Math.random() < 0.2) {
      const departure = setMinutes(setHours(date, 11), randomBetween(0, 30));
      const arrival = addMinutes(departure, randomBetween(15, 25));
      rides.push({
        userId: user.id, platform: 'ola', rideType: 'auto',
        originAddress: locations.home.address, originLat: locations.home.lat, originLng: locations.home.lng,
        destAddress: locations.friend.address, destLat: locations.friend.lat, destLng: locations.friend.lng,
        departureTime: departure, arrivalTime: arrival, cost: randomBetween(70, 120), distance: randomBetween(3, 5), dayOfWeek,
      });
    }
  }

  await prisma.rideHistory.createMany({ data: rides });
  console.log(`Created ${rides.length} ride history records`);

  // ---- Generate food order history ----
  const foodOrders: FoodOrderData[] = [];

  for (let daysAgo = 90; daysAgo >= 0; daysAgo--) {
    const date = subDays(new Date(), daysAgo);
    const dayOfWeek = date.getDay();

    // Weeknight dinner orders (Mon-Fri), ~80% chance
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && Math.random() < 0.8) {
      const orderMin = addJitter(30, 15); // around 8:30 PM
      const orderTime = setMinutes(setHours(date, 20), Math.max(0, Math.min(59, orderMin)));

      let cuisine: string;
      let restaurantPool: typeof foodRestaurants.biryani;

      if (dayOfWeek === 5) {
        // Friday: biryani ~75% of the time
        if (Math.random() < 0.75) {
          cuisine = 'biryani';
          restaurantPool = foodRestaurants.biryani;
        } else {
          cuisine = pick(['chinese', 'burgers', 'pizza']);
          restaurantPool = foodRestaurants[cuisine as keyof typeof foodRestaurants];
        }
      } else if (dayOfWeek === 1) {
        // Monday: healthy/light meals ~65% of the time
        if (Math.random() < 0.65) {
          cuisine = 'healthy';
          restaurantPool = foodRestaurants.healthy;
        } else {
          cuisine = pick(['chinese', 'biryani']);
          restaurantPool = foodRestaurants[cuisine as keyof typeof foodRestaurants];
        }
      } else if (dayOfWeek === 3) {
        // Wednesday: chinese ~50%
        if (Math.random() < 0.5) {
          cuisine = 'chinese';
          restaurantPool = foodRestaurants.chinese;
        } else {
          cuisine = pick(['biryani', 'healthy', 'burgers']);
          restaurantPool = foodRestaurants[cuisine as keyof typeof foodRestaurants];
        }
      } else {
        // Tuesday, Thursday: mixed
        cuisine = pick(['biryani', 'healthy', 'chinese', 'burgers', 'pizza']);
        restaurantPool = foodRestaurants[cuisine as keyof typeof foodRestaurants];
      }

      const restaurant = pick(restaurantPool);
      // Pick 1-3 items from the restaurant
      const numItems = randomBetween(1, Math.min(3, restaurant.items.length));
      const shuffled = [...restaurant.items].sort(() => Math.random() - 0.5);
      const selectedItems = shuffled.slice(0, numItems).map((item) => ({
        name: item.name,
        quantity: 1,
        price: item.price + randomBetween(-20, 20),
      }));

      const totalCost = selectedItems.reduce((s, i) => s + i.price * i.quantity, 0);
      const deliveryFee = Math.random() < 0.3 ? 0 : randomBetween(15, 45);

      foodOrders.push({
        userId: user.id,
        platform: restaurant.platform,
        restaurantName: restaurant.name,
        items: selectedItems,
        cuisine,
        totalCost: totalCost + deliveryFee,
        deliveryFee,
        orderTime,
        deliveryDurationMinutes: randomBetween(25, 50),
        dayOfWeek,
        rating: Math.random() < 0.4 ? parseFloat((3.5 + Math.random() * 1.5).toFixed(1)) : null,
      });
    }

    // Weekend lunch orders (Sat/Sun), ~40% chance
    if ((dayOfWeek === 0 || dayOfWeek === 6) && Math.random() < 0.4) {
      const orderTime = setMinutes(setHours(date, 13), randomBetween(0, 30));
      const cuisine = pick(['biryani', 'burgers', 'pizza', 'chinese']);
      const restaurantPool = foodRestaurants[cuisine as keyof typeof foodRestaurants];
      const restaurant = pick(restaurantPool);

      const numItems = randomBetween(2, Math.min(3, restaurant.items.length));
      const shuffled = [...restaurant.items].sort(() => Math.random() - 0.5);
      const selectedItems = shuffled.slice(0, numItems).map((item) => ({
        name: item.name,
        quantity: randomBetween(1, 2),
        price: item.price + randomBetween(-15, 25),
      }));

      const totalCost = selectedItems.reduce((s, i) => s + i.price * i.quantity, 0);
      const deliveryFee = Math.random() < 0.3 ? 0 : randomBetween(15, 45);

      foodOrders.push({
        userId: user.id,
        platform: restaurant.platform,
        restaurantName: restaurant.name,
        items: selectedItems,
        cuisine,
        totalCost: totalCost + deliveryFee,
        deliveryFee,
        orderTime,
        deliveryDurationMinutes: randomBetween(30, 55),
        dayOfWeek,
        rating: Math.random() < 0.3 ? parseFloat((3.5 + Math.random() * 1.5).toFixed(1)) : null,
      });
    }
  }

  await prisma.foodOrderHistory.createMany({ data: foodOrders });
  console.log(`Created ${foodOrders.length} food order history records`);

  // ---- Sample ride suggestion feedback ----
  const rideSuggestion = await prisma.suggestion.create({
    data: {
      userId: user.id,
      status: 'dismissed',
      originAddress: locations.home.address,
      originLat: locations.home.lat,
      originLng: locations.home.lng,
      destAddress: locations.office.address,
      destLat: locations.office.lat,
      destLng: locations.office.lng,
      suggestedDepartureTime: setMinutes(setHours(subDays(new Date(), 3), 9), 10),
      explanation: 'You usually leave for office around 9:15 AM on weekdays.',
    },
  });

  await prisma.suggestionFeedback.create({
    data: {
      userId: user.id,
      suggestionId: rideSuggestion.id,
      action: 'dismissed',
      dismissReason: 'Working from home today',
    },
  });

  // ---- Sample food suggestion feedback ----
  const foodSuggestion = await prisma.foodSuggestion.create({
    data: {
      userId: user.id,
      status: 'dismissed',
      platform: 'swiggy',
      restaurantName: 'Paradise Biryani',
      items: [{ name: 'Chicken Biryani', quantity: 1, price: 299 }],
      cuisine: 'biryani',
      estimatedCost: 329,
      estimatedDeliveryMin: 35,
      explanation: 'You usually order biryani on Friday evenings.',
    },
  });

  await prisma.foodSuggestionFeedback.create({
    data: {
      userId: user.id,
      suggestionId: foodSuggestion.id,
      action: 'dismissed',
      dismissReason: 'Eating out tonight',
    },
  });

  console.log('Created sample feedback records');
  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
