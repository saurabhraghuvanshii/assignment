/**
 * Live ride data integration layer.
 * Tries REAL Uber scraper first, then falls back to simulated data.
 * Ola/Rapido data is always simulated (Uber is the required platform integration).
 */

import {
  getUberEstimates,
  mapProductToRideType,
} from './scrapers/uber-scraper';

export interface PlatformQuote {
  platform: string;
  platformDisplayName: string;
  rideType: string;
  rideTypeDisplayName: string;
  price: number;
  priceDisplay: string;
  eta: number;
  tripDuration: number;
  surgeMultiplier: number;
  available: boolean;
  error?: string;
}

export interface LiveDataResult {
  quotes: PlatformQuote[];
  trafficCondition: 'low' | 'moderate' | 'heavy' | 'severe';
  trafficDelayMinutes: number;
  fetchedAt: Date;
  errors: string[];
  dataSource: {
    uber: 'live' | 'simulated' | 'error';
    ola: 'simulated';
    rapido: 'simulated';
  };
}

// Simulate traffic based on time of day
function getTrafficCondition(hour: number, dayOfWeek: number): { condition: 'low' | 'moderate' | 'heavy' | 'severe'; delayMinutes: number } {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  if (isWeekday) {
    // Morning rush: 8-10 AM
    if (hour >= 8 && hour <= 10) {
      const severity = Math.random();
      if (severity > 0.7) return { condition: 'severe', delayMinutes: Math.floor(Math.random() * 15) + 15 };
      if (severity > 0.3) return { condition: 'heavy', delayMinutes: Math.floor(Math.random() * 10) + 10 };
      return { condition: 'moderate', delayMinutes: Math.floor(Math.random() * 8) + 5 };
    }
    // Evening rush: 5-8 PM
    if (hour >= 17 && hour <= 20) {
      const severity = Math.random();
      if (severity > 0.6) return { condition: 'severe', delayMinutes: Math.floor(Math.random() * 20) + 15 };
      if (severity > 0.2) return { condition: 'heavy', delayMinutes: Math.floor(Math.random() * 12) + 8 };
      return { condition: 'moderate', delayMinutes: Math.floor(Math.random() * 8) + 5 };
    }
  }

  // Off-peak or weekend
  if (Math.random() > 0.7) return { condition: 'moderate', delayMinutes: Math.floor(Math.random() * 5) + 3 };
  return { condition: 'low', delayMinutes: 0 };
}

// Simulated surge pricing
function getSurge(hour: number, platform: string): number {
  const isPeak = (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20);
  if (!isPeak) return 1.0;

  const baseSurge = platform === 'uber' ? 1.3 : platform === 'ola' ? 1.2 : 1.1;
  // Add randomness
  return parseFloat((baseSurge + Math.random() * 0.5).toFixed(1));
}

// Base prices for ~7km ride in Bangalore
const basePrices: Record<string, Record<string, number>> = {
  uber: { auto: 95, bike: 55, cab: 210, premium: 350 },
  ola: { auto: 85, bike: 50, cab: 190, premium: 320 },
  rapido: { auto: 75, bike: 40, cab: 170, premium: 0 },
};

const platformNames: Record<string, string> = {
  uber: 'Uber',
  ola: 'Ola',
  rapido: 'Rapido',
};

const rideTypeNames: Record<string, string> = {
  auto: 'Auto',
  bike: 'Bike',
  cab: 'Cab',
  premium: 'Premium',
};

const SCRAPER_ENABLED = process.env.SCRAPER_ENABLED !== 'false';

/**
 * Fetch live data from all platforms.
 * Uber: tries real scraper first, falls back to simulated.
 * Ola/Rapido: always simulated (only Uber is required by the assignment).
 * Handles failures gracefully — if a platform fails, others still return.
 */
export async function fetchLiveData(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  distanceKm?: number
): Promise<LiveDataResult> {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const traffic = getTrafficCondition(hour, dayOfWeek);
  const distance = distanceKm || estimateDistance(originLat, originLng, destLat, destLng);

  const quotes: PlatformQuote[] = [];
  const errors: string[] = [];
  let uberSource: 'live' | 'simulated' | 'error' = 'simulated';

  // --- Uber: try REAL scraper, fall back to simulated ---
  if (SCRAPER_ENABLED) {
    try {
      const realQuotes = await fetchRealUberData(
        originLat, originLng, destLat, destLng, distance, traffic.delayMinutes
      );
      if (realQuotes.length > 0) {
        quotes.push(...realQuotes);
        uberSource = 'live';
        console.log(`[Live Data] Uber: ${realQuotes.length} quotes from REAL scraper`);
      } else {
        throw new Error('Real scraper returned no quotes');
      }
    } catch (e) {
      console.warn(`[Live Data] Uber scraper failed, falling back to simulated:`, (e as Error).message);
      uberSource = 'simulated';
      try {
        const simQuotes = await fetchSimulatedPlatformQuotes('uber', distance, hour, traffic.delayMinutes);
        quotes.push(...simQuotes);
      } catch {
        uberSource = 'error';
        const errorMsg = 'Uber: Service temporarily unavailable';
        errors.push(errorMsg);
        quotes.push({
          platform: 'uber',
          platformDisplayName: 'Uber',
          rideType: 'cab',
          rideTypeDisplayName: 'Cab',
          price: 0,
          priceDisplay: '--',
          eta: 0,
          tripDuration: 0,
          surgeMultiplier: 1,
          available: false,
          error: errorMsg,
        });
      }
    }
  } else {
    try {
      const simQuotes = await fetchSimulatedPlatformQuotes('uber', distance, hour, traffic.delayMinutes);
      quotes.push(...simQuotes);
    } catch {
      const errorMsg = 'Uber: Service temporarily unavailable';
      errors.push(errorMsg);
    }
  }

  // --- Ola & Rapido: always simulated ---
  for (const platform of ['ola', 'rapido']) {
    try {
      const platformQuotes = await fetchSimulatedPlatformQuotes(platform, distance, hour, traffic.delayMinutes);
      quotes.push(...platformQuotes);
    } catch {
      const errorMsg = `${platformNames[platform]}: Service temporarily unavailable`;
      errors.push(errorMsg);
      quotes.push({
        platform,
        platformDisplayName: platformNames[platform],
        rideType: 'cab',
        rideTypeDisplayName: 'Cab',
        price: 0,
        priceDisplay: '--',
        eta: 0,
        tripDuration: 0,
        surgeMultiplier: 1,
        available: false,
        error: errorMsg,
      });
    }
  }

  return {
    quotes: quotes.filter(q => q.available || q.error),
    trafficCondition: traffic.condition,
    trafficDelayMinutes: traffic.delayMinutes,
    fetchedAt: now,
    errors,
    dataSource: {
      uber: uberSource,
      ola: 'simulated',
      rapido: 'simulated',
    },
  };
}

/**
 * Fetch REAL price estimates from Uber via HTTP scraping.
 */
async function fetchRealUberData(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  distanceKm: number,
  trafficDelay: number
): Promise<PlatformQuote[]> {
  const estimates = await getUberEstimates(originLat, originLng, destLat, destLng);

  return estimates.map((est) => {
    const rideType = mapProductToRideType(est.productName);
    const avgPrice = Math.round((est.lowPrice + est.highPrice) / 2);

    return {
      platform: 'uber',
      platformDisplayName: 'Uber',
      rideType,
      rideTypeDisplayName: rideTypeNames[rideType] || est.productName,
      price: avgPrice,
      priceDisplay: avgPrice > 0 ? `₹${avgPrice}` : est.priceEstimate,
      eta: est.etaMinutes || randomBetween(3, 8),
      tripDuration: est.tripDurationMinutes || Math.round((distanceKm / 25) * 60) + trafficDelay,
      surgeMultiplier: est.surgeMultiplier,
      available: true,
    };
  });
}

async function fetchSimulatedPlatformQuotes(
  platform: string,
  distanceKm: number,
  hour: number,
  trafficDelay: number
): Promise<PlatformQuote[]> {
  // Simulate occasional platform failure (5% chance)
  if (Math.random() < 0.05) {
    throw new Error(`${platform} API timeout`);
  }

  const surge = getSurge(hour, platform);
  const quotes: PlatformQuote[] = [];
  const availableTypes = Object.keys(basePrices[platform]).filter(t => basePrices[platform][t] > 0);

  for (const rideType of availableTypes) {
    const basePrice = basePrices[platform][rideType];
    // Price scales roughly with distance and surge
    const distanceFactor = distanceKm / 7;
    const price = Math.round(basePrice * distanceFactor * surge);
    // ETA: base 3-8 min + traffic delay for cabs; less for bikes/autos
    const baseEta = rideType === 'bike' ? randomBetween(2, 5) : rideType === 'auto' ? randomBetween(3, 7) : randomBetween(4, 10);
    // Trip duration based on distance + traffic
    const baseTripDuration = Math.round((distanceKm / 25) * 60); // ~25 km/h average
    const tripDuration = baseTripDuration + (rideType === 'bike' ? Math.round(trafficDelay / 2) : trafficDelay);

    quotes.push({
      platform,
      platformDisplayName: platformNames[platform],
      rideType,
      rideTypeDisplayName: rideTypeNames[rideType],
      price,
      priceDisplay: `₹${price}`,
      eta: baseEta,
      tripDuration,
      surgeMultiplier: surge,
      available: true,
    });
  }

  return quotes;
}

function estimateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  // Haversine approximation
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Multiply by 1.3 for road distance estimate
  return parseFloat((R * c * 1.3).toFixed(1));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
