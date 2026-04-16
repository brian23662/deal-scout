/**
 * Craigslist scraper — direct fetch + Cheerio/JSON-LD parsing
 * Called by the Vercel cron route (/api/cron) via cron-job.org
 *
 * Scrapes targeted categories to keep listing counts manageable
 * and eBay comps relevant. No third-party scraping service needed —
 * runs directly from Vercel using Craigslist's public JSON-LD data.
 *
 * Categories:
 *   grq — Farm & Garden (mowers, tractors, generators)
 *   app — Appliances
 *   tls — Tools
 *   bfs — Business/Commercial (pressure washers, restaurant equipment)
 *   spo — Sporting Goods
 *
 * 8 markets × 5 categories = 40 requests per cron run
 */

import * as cheerio from 'cheerio'
import { Listing } from '@/types'
import { getDistanceMiles } from '@/lib/geo'

const HOME_LAT = 29.2866
const HOME_LNG = -81.0559
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

const CL_CATEGORIES = [
  { code: 'grq', label: 'Farm & Garden' },
  { code: 'app', label: 'Appliances' },
  { code: 'tls', label: 'Tools' },
  { code: 'bfs', label: 'Business/Commercial' },
  { code: 'spo', label: 'Sporting Goods' },
]

export async function scrapeCraigslist(): Promise<Listing[]> {
  const allListings: Listing[] = []
  const seen = new Set<string>()

  for (const market of FL_MARKETS) {
    for (const category of CL_CATEGORIES) {
      try {
        const listings = await scrapeMarketCategory(market, category.code)
        for (const listing of listings) {
          if (seen.has(listing.external_id)) continue
          seen.add(listing.external_id)
          allListings.push(listing)
        }
        console.log(`${market.subdomain}/${category.label}: ${listings.length} listings`)
      } catch (e: any) {
        console.error(`CL error ${market.subdomain}/${category.label}:`, e.message)
      }
      // Polite delay between requests
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  console.log(`Craigslist total unique: ${allListings.length}`)
  return allListings
}

async function scrapeMarketCategory(
  market: typeof FL_MARKETS[0],
  categoryCode: string
): Promise<Listing[]> {
  const params = new URLSearchParams({ min_price: String(MIN_PRICE), sort: 'date' })
  const url = `https://${market.subdomain}.craigslist.org/search/${categoryCode}?${params}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)

  const html = await response.text()
  const $ = cheerio.load(html)

  // Parse JSON-LD results embedded in the page
  const jsonLdText = $('#ld_searchpage_results').text()
  if (!jsonLdText) {
    console.warn(`  No JSON-LD for ${market.subdomain}/${categoryCode}`)
    return []
  }

  const jsonData = JSON.parse(jsonLdText)
  const items: any[] = jsonData?.itemListElement || []

  // Build a Map of { listingId -> full URL } from anchor tags.
  // Using a Map keyed by the 10-digit listing ID makes the lookup
  // position-independent — extra nav/footer links can't shift the pairing.
  const urlMap = new Map<string, string>()
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    const idMatch = href.match(/\/(\d{10})\.html/)
    if (idMatch) {
      const full = href.startsWith('http')
        ? href
        : `https://${market.subdomain}.craigslist.org${href}`
      urlMap.set(idMatch[1], full)
    }
  })

  const listings: Listing[] = []
  for (let i = 0; i < items.length; i++) {
    try {
      const item = items[i]?.item
      if (!item) continue

      const title: string = item.name || ''
      const price = parseFloat(item.offers?.price || '0')
      const images: string[] = Array.isArray(item.image)
        ? item.image
        : item.image ? [item.image] : []

      // Extract the listing ID from the JSON-LD item's own url field,
      // then look up the full URL in the map. This guarantees title and
      // URL always refer to the same listing.
      const itemId = item.url?.match(/\/(\d{10})\.html/)?.[1]
      if (!itemId) continue
      const itemUrl = urlMap.get(itemId)
      if (!itemUrl) continue

      if (!price || price < MIN_PRICE) continue

      listings.push({
        platform: 'craigslist',
        external_id: itemId,
        title,
        asking_price: price,
        make: extractMake(title),
        model: extractModel(title),
        hours: extractHours(title),
        location_city: market.city,
        location_state: market.state,
        distance_miles: getDistanceMiles(HOME_LAT, HOME_LNG, market.lat, market.lng),
        url: itemUrl,
        image_urls: images,
        posted_at: '',
        scraped_at: new Date().toISOString(),
      })
    } catch {}
  }

  return listings
}

const BRANDS = [
  'Toro', 'Bad Boy', 'Husqvarna', 'John Deere', 'Kubota', 'Scag',
  'Exmark', 'Gravely', 'Ferris', 'Ariens', 'Cub Cadet', 'Simplicity',
  'Club Car', 'EZGO', 'Yamaha', 'Honda', 'Generac', 'DeWalt', 'Milwaukee',
]
function extractMake(t: string) { return BRANDS.find(b => t.toUpperCase().includes(b.toUpperCase())) }
function extractModel(t: string) { return t.match(/\b([A-Z]{1,3}[-\s]?\d{3,5}[A-Z]?|ZT\s\w+)\b/i)?.[0] }
function extractHours(t: string) { const m = t.match(/(\d+)\s*(?:hours?|hrs?)/i); return m ? parseInt(m[1]) : undefined }
