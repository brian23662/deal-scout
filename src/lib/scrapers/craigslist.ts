/**
 * Craigslist scraper via Apify actor (automation-lab~craigslist-scraper)
 * Price-driven approach: no keyword filter, just min_price.
 * All scoring and relevance filtering is handled downstream by eBay comps.
 * 1 call per market = 8 Apify calls per cron run.
 */

import { Listing } from '@/types'
import { getDistanceMiles } from '@/lib/geo'

const HOME_LAT = 29.2866
const HOME_LNG = -81.0559
const APIFY_BASE = 'https://api.apify.com/v2'
const CL_ACTOR_ID = 'automation-lab~craigslist-scraper'
const MIN_PRICE = 500

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
  const seen = new Set<string>()

  for (const market of FL_MARKETS) {
    try {
      const items = await runApifyActor(token, market.subdomain)
      for (const item of items) {
        const listing = mapItem(item, market)
        if (!listing) continue
        if (seen.has(listing.url)) continue
        seen.add(listing.url)
        allListings.push(listing)
      }
      console.log(`${market.subdomain}: ${items.length} raw, ${allListings.length} total so far`)
    } catch (e) {
      console.error(`CL Apify ${market.subdomain} error:`, e)
    }
    await new Promise(r => setTimeout(r, 500))
  }

  return allListings
}

async function runApifyActor(token: string, subdomain: string): Promise<ApifyCLItem[]> {
  const response = await fetch(
    `${APIFY_BASE}/acts/${CL_ACTOR_ID}/run-sync-get-dataset-items?token=${token}&timeout=60&memory=256`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city: subdomain,
        category: 'for_sale',
        // No searchQuery — returns all for-sale listings above min price
        // eBay comp scoring filters out low-value items naturally
        minPrice: MIN_PRICE,
        maxResults: 100,
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

  const url = item.url || ''
  if (!url) return null

  const externalId = extractCraigslistId(url) || item.listingId || url

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
    url,
    image_urls: item.imageUrls || [],
    posted_at: item.postedAt || '',
    scraped_at: new Date().toISOString(),
  }
}

function extractCraigslistId(href: string): string | undefined {
  return href.match(/\/(\d{10})\.html/)?.[1]
}

const BRANDS = ['Toro', 'Bad Boy', 'Husqvarna', 'John Deere', 'Kubota', 'Scag', 'Exmark', 'Gravely', 'Ferris', 'Ariens', 'Cub Cadet', 'Simplicity']
function extractMake(title: string): string | undefined { return BRANDS.find(b => title.toUpperCase().includes(b.toUpperCase())) }
function extractModel(title: string): string | undefined { return title.match(/\b([A-Z]{1,3}[-\s]?\d{3,5}[A-Z]?|ZT\s\w+)\b/i)?.[0] }
function extractHours(text: string): number | undefined { const m = text.match(/(\d+)\s*(?:hours?|hrs?)/i); return m ? parseInt(m[1]) : undefined }
