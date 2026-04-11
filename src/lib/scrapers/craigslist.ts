/**
 * Craigslist scraper via Apify actor (automation-lab~craigslist-scraper)
 *
 * KEYWORD-DRIVEN approach: one Apify call per keyword per market.
 * This ensures we only fetch relevant listings (mowers, golf carts, etc.)
 * instead of all $500+ items. Far cheaper on Apify quota.
 *
 * Apify calls per cron run: 8 markets × N keywords
 * At 3 keywords: 24 calls/run (well within free tier at 2 runs/day)
 */

import { Listing } from '@/types'
import { getDistanceMiles } from '@/lib/geo'

const HOME_LAT = 29.2866
const HOME_LNG = -81.0559
const APIFY_BASE = 'https://api.apify.com/v2'
const CL_ACTOR_ID = 'automation-lab~craigslist-scraper'
const MIN_PRICE = 500

// Keywords to search for. Keep this list focused — each adds 8 Apify calls per run.
// Phase 2: add 'golf cart', 'utility trailer', 'pressure washer'
const SEARCH_KEYWORDS = [
  'zero turn mower',
  'riding mower',
  'lawn tractor',
]

const FL_MARKETS = [
  { subdomain: 'daytona',      city: 'Daytona Beach',  state: 'FL', lat: 29.2108, lng: -81.0228 },
  { subdomain: 'orlando',      city: 'Orlando',        state: 'FL', lat: 28.5383, lng: -81.3792 },
  { subdomain: 'jacksonville', city: 'Jacksonville',   state: 'FL', lat: 30.3322, lng: -81.6557 },
  { subdomain: 'tampa',        city: 'Tampa',          state: 'FL', lat: 27.9506, lng: -82.4572 },
  { subdomain: 'lakeland',     city: 'Lakeland',       state: 'FL', lat: 28.0395, lng: -81.9498 },
  { subdomain: 'gainesville',  city: 'Gainesville',    state: 'FL', lat: 29.6516, lng: -82.3248 },
  { subdomain: 'ocala',        city: 'Ocala',          state: 'FL', lat: 29.1872, lng: -82.1401 },
  { subdomain: 'treasure',     city: 'Treasure Coast', state: 'FL', lat: 27.2711, lng: -80.3582 },
]

interface ApifyCLItem {
  listingId?: string
  title?: string
  price?: string
  priceNumeric?: number
  url?: string
  imageUrls?: string[]
  postedAt?: string
}

export async function scrapeCraigslist(): Promise<Listing[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) {
    console.warn('APIFY_API_TOKEN not set — skipping Craigslist scrape')
    return []
  }

  const allListings: Listing[] = []
  const seen = new Set<string>() // dedup by listing URL

  for (const market of FL_MARKETS) {
    for (const keyword of SEARCH_KEYWORDS) {
      try {
        const items = await runApifyActor(token, market.subdomain, keyword)
        for (const item of items) {
          const listing = mapItem(item, market)
          if (!listing) continue
          // Dedup across keyword searches in same market
          if (seen.has(listing.external_id)) continue
          seen.add(listing.external_id)
          allListings.push(listing)
        }
        console.log(`${market.subdomain} [${keyword}]: ${items.length} raw items`)
      } catch (e) {
        console.error(`CL Apify ${market.subdomain} [${keyword}] error:`, e)
      }
      // Be polite to Apify between calls
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`Craigslist total unique: ${allListings.length}`)
  return allListings
}

async function runApifyActor(
  token: string,
  subdomain: string,
  keyword: string
): Promise<ApifyCLItem[]> {
  const response = await fetch(
    `${APIFY_BASE}/acts/${CL_ACTOR_ID}/run-sync-get-dataset-items?token=${token}&timeout=60&memory=256`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city: subdomain,
        category: 'for_sale',
        searchQuery: keyword,
        minPrice: MIN_PRICE,
        maxResults: 50, // 50 per keyword is plenty; reduces quota burn
        includeDetails: false,
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Apify actor failed: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

function mapItem(item: ApifyCLItem, market: typeof FL_MARKETS[0]): Listing | null {
  const title = item.title || ''
  const price = item.priceNumeric ?? parseFloat(String(item.price || '').replace(/[^0-9.]/g, ''))

  if (!price || price < MIN_PRICE) return null

  // Build canonical CL URL from the numeric listing ID.
  // Apify sometimes returns a redirect/tracking URL — reconstruct
  // the real URL so "View Listing" goes to the right place.
  const rawUrl = item.url || ''
  const listingId = extractCraigslistId(rawUrl) || item.listingId || ''

  // Canonical URL: https://{subdomain}.craigslist.org/search/sss#{id}
  // But the direct item URL is more reliable:
  // https://{subdomain}.craigslist.org/for_sale/{id}.html
  // We reconstruct it if we have the numeric ID.
  const canonicalUrl = listingId && /^\d{10}$/.test(listingId)
    ? `https://${market.subdomain}.craigslist.org/d/item/${listingId}.html`
    : rawUrl // Fall back to whatever Apify gave us

  if (!canonicalUrl) return null

  const externalId = listingId || rawUrl

  return {
    platform: 'craigslist',
    external_id: externalId,
    title,
    asking_price: price,
    make: extractMake(title),
    model: extractModel(title),
    hours: extractHours(title),
    location_city: market.city,
    location_state: market.state,
    distance_miles: getDistanceMiles(HOME_LAT, HOME_LNG, market.lat, market.lng),
    url: canonicalUrl,
    image_urls: item.imageUrls || [],
    posted_at: item.postedAt || '',
    scraped_at: new Date().toISOString(),
  }
}

/** Extracts the 10-digit numeric listing ID from a Craigslist URL */
function extractCraigslistId(href: string): string | undefined {
  return href.match(/\/(\d{10})\.html/)?.[1]
    || href.match(/#(\d{10})$/)?.[1]
    || href.match(/\/ctl\/(\d+)/)?.[1]
}

const BRANDS = ['Toro', 'Bad Boy', 'Husqvarna', 'John Deere', 'Kubota', 'Scag', 'Exmark', 'Gravely', 'Ferris', 'Ariens', 'Cub Cadet', 'Simplicity']
function extractMake(title: string): string | undefined { return BRANDS.find(b => title.toUpperCase().includes(b.toUpperCase())) }
function extractModel(title: string): string | undefined { return title.match(/\b([A-Z]{1,3}[-\s]?\d{3,5}[A-Z]?|ZT\s\w+)\b/i)?.[0] }
function extractHours(text: string): number | undefined { const m = text.match(/(\d+)\s*(?:hours?|hrs?)/i); return m ? parseInt(m[1]) : undefined }
