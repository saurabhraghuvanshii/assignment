# ProAssist — Proactive AI Assistant

A proactive assistant that learns from user behavior and suggests rides and food orders before you need them. Compares prices and ETAs across Uber, Ola, Rapido, Swiggy, and Zomato.

## Features

### Ride Assistant
- **Learns** from ride history: frequent destinations by day/time, preferred platforms and ride types
- **Detects** when a ride is likely needed based on time patterns, cooldowns, and confidence thresholds
- **Suggests** complete rides with origin/destination, traffic-adjusted departure time, and cross-platform price comparison (Uber, Ola, Rapido)
- One-tap confirm, full edit support (origin, destination, time, platform, ride type)

### Food Assistant
- **Learns** from order history: favorite cuisines, restaurants, items, and ordering patterns by day/time
- **Detects** when an order is likely (e.g., Friday biryani night, Monday healthy meals)
- **Suggests** complete orders with restaurant, items, delivery ETA, and alternatives
- One-tap confirm, full edit support (restaurant, platform, individual items)

### Architecture
- **Trigger Engine**: Watches time-of-day patterns, confidence thresholds (0.5 for rides, 0.35 for food), 2-hour dismissal cooldowns, consecutive dismissal dampening, checks for already-completed trips/orders
- **Learning Engine**: Frequency analysis with 2× recency weighting for last 30 days, feedback loop from edits/dismissals adjusting pattern confidence and preferences
- **Live Data**: Simulated platform APIs with 5% failure rate, graceful degradation when platforms are unreachable, fallback to available platforms
- **Memory**: PostgreSQL with Prisma ORM — stores ride/food history, learned patterns, suggestions, and all user feedback

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **UI**: React 19, Lucide icons, custom CSS design system (dark theme)
- **Database**: PostgreSQL 16 + Prisma 7
- **Language**: TypeScript 5

## Quick Start

### Option 1: Docker (recommended)

```bash
docker compose up
```

This starts PostgreSQL, runs migrations, seeds the database, and starts the app at http://localhost:3000.

### Option 2: Local Development

**Prerequisites**: Node.js 20+, PostgreSQL running locally

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env  # or create .env with DATABASE_URL

# Run migrations and generate Prisma client
npx prisma migrate dev
npx prisma generate

# Seed the database with demo data
npx tsx prisma/seed.ts

# Start development server
npm run dev
```

Open http://localhost:3000.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://assistant:assistant123@localhost:5432/proactive_assistant?schema=public` |

## Project Structure

```
src/
├── app/
│   ├── page.tsx                          # Unified UI (Ride + Food assistants)
│   ├── layout.tsx                        # Root layout
│   ├── globals.css                       # Design system + all styles
│   └── api/
│       ├── suggestions/                  # Ride suggestion CRUD
│       ├── ride-history/                 # Ride history listing
│       ├── patterns/                     # Learned ride patterns
│       ├── settings/                     # User settings
│       └── food/
│           ├── suggestions/              # Food suggestion CRUD
│           ├── order-history/            # Food order history
│           └── patterns/                 # Learned food patterns
├── lib/
│   ├── prisma.ts                         # Database singleton
│   ├── learning-engine.ts                # Ride pattern analysis
│   ├── trigger-engine.ts                 # Ride trigger logic
│   ├── suggestion-builder.ts             # Ride suggestion builder
│   ├── live-data.ts                      # Simulated ride platform APIs
│   ├── food-learning-engine.ts           # Food pattern analysis
│   ├── food-trigger-engine.ts            # Food trigger logic
│   ├── food-suggestion-builder.ts        # Food suggestion builder
│   └── food-live-data.ts                 # Simulated food platform APIs
prisma/
├── schema.prisma                         # Database schema (10 models)
├── seed.ts                               # Demo data generator
└── migrations/                           # SQL migrations
```

## How It Works

### Trigger Flow
1. User opens dashboard → API called
2. **Learning engine** analyzes all history, extracts patterns with frequency + recency weighting
3. **Trigger engine** checks: Is current time within ±30 min of a pattern? Is confidence high enough? Any cooldowns active? Already completed this trip/order today?
4. If triggered → **Suggestion builder** fetches live data from platforms, adjusts for traffic/delivery conditions, builds explanation
5. User sees suggestion with "why" explanation, can confirm, edit, or dismiss
6. Feedback loops back: confirmations reset dismissal counts, edits update preferred platforms, dismissals increment dampening counters

### Anti-Annoyance Measures
- **Confidence thresholds**: Only trigger on patterns seen multiple times
- **2-hour cooldowns**: No re-trigger after a dismissal
- **Consecutive dismissal dampening**: After 3+ dismissals, effective confidence drops
- **Already-completed checks**: Skip if user already rode/ordered for this pattern today
- **Recency decay**: Old patterns lose weight over time

## Seed Data

The seed script generates ~90 days of realistic data for user "Rahul Sharma" in Bangalore:
- **Rides**: ~113 records — weekday commutes (home-office), Saturday gym trips, occasional mall/restaurant visits
- **Food**: ~68 records — weeknight dinners (biryani Fridays, healthy Mondays, Chinese Wednesdays), weekend lunches
