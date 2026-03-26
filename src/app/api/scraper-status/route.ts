import { NextResponse } from 'next/server';

export async function GET() {
  const scraperEnabled = process.env.SCRAPER_ENABLED !== 'false';

  return NextResponse.json({
    scraperEnabled,
    platforms: {
      uber: {
        type: 'ride',
        scraperAvailable: true,
        mode: scraperEnabled ? 'live_with_fallback' : 'simulated',
        description: scraperEnabled
          ? 'Tries real Uber scraper first, falls back to simulated data'
          : 'Using simulated data only',
      },
      ola: {
        type: 'ride',
        scraperAvailable: false,
        mode: 'simulated',
        description: 'Simulated data (optional platform)',
      },
      rapido: {
        type: 'ride',
        scraperAvailable: false,
        mode: 'simulated',
        description: 'Simulated data (optional platform)',
      },
      zomato: {
        type: 'food',
        scraperAvailable: true,
        mode: scraperEnabled ? 'live_with_fallback' : 'simulated',
        description: scraperEnabled
          ? 'Tries real Zomato scraper first, falls back to simulated data'
          : 'Using simulated data only',
      },
      swiggy: {
        type: 'food',
        scraperAvailable: false,
        mode: 'simulated',
        description: 'Simulated data (optional platform)',
      },
    },
    configuration: {
      SCRAPER_ENABLED: scraperEnabled,
      ZOMATO_LOCATION_MODE: 'user-default',
    },
  });
}
