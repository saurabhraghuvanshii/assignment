import { prisma } from "./prisma";
import { fetchLiveData, LiveDataResult } from "./live-data";
import { format, addMinutes, setHours, setMinutes } from "date-fns";

export interface RideSuggestion {
  id: string;
  status: string;
  patternId: string | null;
  origin: {
    address: string;
    lat: number;
    lng: number;
  };
  destination: {
    address: string;
    lat: number;
    lng: number;
  };
  suggestedDepartureTime: Date;
  suggestedDepartureTimeDisplay: string;
  explanation: string;
  liveData: LiveDataResult;
  recommendedPlatform: string | null;
  recommendedRideType: string | null;
  confidence: number;
}

const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Builds a complete suggestion from a detected pattern.
 * Fetches live data, adjusts departure time for traffic, and generates
 * human-readable explanation.
 */
export async function buildSuggestion(
  userId: string,
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
  },
): Promise<RideSuggestion> {
  // Fetch live pricing/ETA data
  const liveData = await fetchLiveData(
    pattern.originLat,
    pattern.originLng,
    pattern.destLat,
    pattern.destLng,
  );

  // Calculate adjusted departure time based on traffic
  const now = new Date();
  let suggestedDeparture = setMinutes(setHours(now, pattern.hourOfDay), 15);

  // If traffic is bad, suggest leaving earlier
  if (liveData.trafficDelayMinutes > 10) {
    suggestedDeparture = addMinutes(
      suggestedDeparture,
      -liveData.trafficDelayMinutes,
    );
  }

  // If departure time is in the past, use "now + 5 min"
  if (suggestedDeparture < now) {
    suggestedDeparture = addMinutes(now, 5);
  }

  // Build explanation
  const explanation = buildExplanation(pattern, liveData);

  // Check for existing pending suggestion
  const existingSuggestion = await prisma.suggestion.findFirst({
    where: {
      userId,
      status: "pending",
      destAddress: pattern.destAddress,
      createdAt: {
        gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      },
    },
  });

  if (existingSuggestion) {
    // Update existing suggestion with fresh data
    const updated = await prisma.suggestion.update({
      where: { id: existingSuggestion.id },
      data: {
        suggestedDepartureTime: suggestedDeparture,
        explanation,
        platformData: JSON.parse(JSON.stringify(liveData)),
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      patternId: pattern.id,
      origin: {
        address: pattern.originAddress,
        lat: pattern.originLat,
        lng: pattern.originLng,
      },
      destination: {
        address: pattern.destAddress,
        lat: pattern.destLat,
        lng: pattern.destLng,
      },
      suggestedDepartureTime: suggestedDeparture,
      suggestedDepartureTimeDisplay: format(suggestedDeparture, "h:mm a"),
      explanation,
      liveData,
      recommendedPlatform: pattern.preferredPlatform,
      recommendedRideType: pattern.preferredRideType,
      confidence: pattern.confidence,
    };
  }

  // Create new suggestion
  const suggestion = await prisma.suggestion.create({
    data: {
      userId,
      patternId: pattern.id,
      originAddress: pattern.originAddress,
      originLat: pattern.originLat,
      originLng: pattern.originLng,
      destAddress: pattern.destAddress,
      destLat: pattern.destLat,
      destLng: pattern.destLng,
      suggestedDepartureTime: suggestedDeparture,
      explanation,
      platformData: JSON.parse(JSON.stringify(liveData)),
    },
  });

  return {
    id: suggestion.id,
    status: suggestion.status,
    patternId: pattern.id,
    origin: {
      address: pattern.originAddress,
      lat: pattern.originLat,
      lng: pattern.originLng,
    },
    destination: {
      address: pattern.destAddress,
      lat: pattern.destLat,
      lng: pattern.destLng,
    },
    suggestedDepartureTime: suggestedDeparture,
    suggestedDepartureTimeDisplay: format(suggestedDeparture, "h:mm a"),
    explanation,
    liveData,
    recommendedPlatform: pattern.preferredPlatform,
    recommendedRideType: pattern.preferredRideType,
    confidence: pattern.confidence,
  };
}

function buildExplanation(
  pattern: {
    hourOfDay: number;
    dayOfWeek: number;
    destAddress: string;
    confidence: number;
  },
  liveData: LiveDataResult,
): string {
  const destShort = getLocationShortName(pattern.destAddress);
  const dayName = dayNames[pattern.dayOfWeek];
  const timeStr = format(new Date(2000, 0, 1, pattern.hourOfDay, 0), "h:mm a");

  let explanation = `You usually head to ${destShort} around ${timeStr} on ${dayName}s`;

  if (
    liveData.trafficCondition === "heavy" ||
    liveData.trafficCondition === "severe"
  ) {
    explanation += `. Traffic is ${liveData.trafficDelayMinutes} min above average — consider leaving earlier`;
  } else if (liveData.trafficCondition === "moderate") {
    explanation += `. Traffic is slightly above normal`;
  } else {
    explanation += `. Traffic looks good right now`;
  }

  const availableSurges = liveData.quotes
    .filter((q) => q.available)
    .map((q) => q.surgeMultiplier);
  const maxSurge =
    availableSurges.length > 0 ? Math.max(...availableSurges) : 1;
  if (maxSurge > 1.3) {
    explanation += `. Surge pricing active (${maxSurge}×)`;
  }

  return explanation;
}

function getLocationShortName(address: string): string {
  // Extract a short name from the address
  if (
    address.toLowerCase().includes("wework") ||
    address.toLowerCase().includes("office")
  )
    return "office";
  if (
    address.toLowerCase().includes("cult") ||
    address.toLowerCase().includes("gym") ||
    address.toLowerCase().includes("fitness")
  )
    return "the gym";
  if (
    address.toLowerCase().includes("phoenix") ||
    address.toLowerCase().includes("mall")
  )
    return "the mall";
  if (
    address.toLowerCase().includes("toit") ||
    address.toLowerCase().includes("brewpub")
  )
    return "Toit";
  if (
    address.toLowerCase().includes("jp nagar") ||
    address.toLowerCase().includes("friend")
  )
    return "your friend's place";
  // Default: use first part of address
  return address.split(",")[0];
}
