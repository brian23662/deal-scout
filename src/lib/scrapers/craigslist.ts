/**
 * Craigslist scraper for Florida markets within 240 miles of Ormond Beach
 * Parses listing data from the JSON-LD script tag (ld_searchpage_results)
 * URLs are extracted from HTML anchor tags and matched to JSON-LD items by index
 */

import * as cheerio from 'cheerio'
import { Listing } from '@/types'
import { getDistanceMiles } from '@/lib/geo'

const FL_MARKETS = [
  { subdomain: 'daytona', city: 'Daytona Beach', state: 'FL', lat: 29.2108, lng: -81.0228 },
  { subdomain: 'orlando', city: 'Orlando', state: 'FL', lat: 28.5383, lng: -81.3792 },
  { subdomain: 'jacksonville', city: 'Jacksonville', state: 'FL', lat: 30.3322, lng: -81.6557 },
  { subdomain: 'tampa', city: 'Tampa', state: 'FL', lat: 27.9506, lng: -82.4572 },
  { subdomain: 'lakeland', city: 'Lakeland', state: 'FL', lat: 28.0395, lng: -81.9498 },
  { subdomain: 'gainesville', city: 'Gainesville', state: 'FL', lat: 29.6516, lng: -82.3248 },
  { subdomain: 'ocala', city: 'Ocala', state: 'FL', lat: 29.1872, lng: -82.1401 },
  { subdomain: 'treasure', city: 'Treasure Coast', state: 'FL', lat: 27.2711, lng: -80.3582 },
]

const HOME_LAT = 29.2866
const HOME_LNG = -81.0559
const MIN_PRICE = 500

const SEARCH_QUERIES = ['zero turn mower', 'riding mower', 'zero turn', 'lawn tractor']

export async function scrapeCraigslist(): Promise<Listing[]> {
  const allListings: Listing[] = []
  const seen = new Set<string>()

  for (const market of FL_MARKETS) {
    for (const query of SEARCH_QUERIES) {
      try {
        const listings = await scrapeMarket(market, query)
        for (const listing of listings) {
          if (!seen.has(listing.url)) {
            seen.add(listing.url)
            allListings.push(listing)
          }
        }
        await new Promise(r => setTimeout(r, 1000))
      } catch (e) {
        console.error(`Craigslist ${market.subdomain} error:`, e)
      }
    }
  }

  return allListings
}

async function scrapeMarket(market: typeof FL_MARKETS[0], query: string): Promise<Listing[]> {
  const params = new URLSearchParams({ query, min_price: String(MIN_PRICE), sort: 'date' })
  const searchUrl = `https://${market.subdomain}.craigslist.org/search/grd?${params}`

  const response = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  })

  if (!response.ok) throw new Error(`HTTP ${response.status} for ${searchUrl}`)

  const html = await response.text()
  const $ = cheerio.load(html)

  // Extract all listing URLs from <a> tags pointing to .html listing pages
  // These appear in order matching the JSON-LD itemListElement array
  const urlsFromHtml: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (/\/\d{10}\.html/.test(href)) {
      const full = href.startsWith('http') ? href : `https://${market.subdomain}.craigslist.org${href}`
      if (!urlsFromHtml.includes(full)) urlsFromHtml.push(full)
    }
  })

  // Parse JSON-LD listing data
  const jsonLdText = $('#ld_searchpage_results').text()
  if (!jsonLdText) {
    console.warn(`No JSON-LD found for ${market.subdomain} / ${query}`)
    return []
  }

  let jsonData: any
  try {
    jsonData = JSON.parse(jsonLdText)
  } catch (e) {
    console.error(`Failed to parse JSON-LD for ${market.subdomain}:`, e)
    return []
  }

  const items: any[] = jsonData?.itemListElement || []
  const listings: Listing[] = []

  for (let i = 0; i < items.length; i++) {
    try {
      const listing = items[i]?.item
      if (!listing) continue

      const title: string = listing.name || ''
      const price = parseFloat(listing.offers?.price || '0')
      const images: string[] = Array.isArray(listing.image) ? listing.image : (listing.image ? [listing.image] : [])

      // Match URL by index — JSON-LD items and HTML anchors appear in the same order
      const itemUrl = urlsFromHtml[i] || ''

      if (!price || price < MIN_PRICE) continue
      if (!isRelevantListing(title)) continue
      if (!itemUrl) continue

      const externalId = extractCraigslistId(itemUrl)
      if (!externalId) continue

      listings.push({
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
        url: itemUrl,
        image_urls: images,
        posted_at: '',
        scraped_at: new Date().toISOString(),
      })
    } catch (e) { /* skip malformed items */ }
  }

  return listings
}

function extractCraigslistId(href: string): string | undefined {
  return href.match(/\/(\d{10})\.html/)?.[1]
}

function isRelevantListing(title: string): boolean {
  const lower = title.toLowerCase()
  const relevant = ['zero turn', 'zeroturn', 'riding mower', 'riding lawn', 'lawn tractor', 'zero-turn', 'mower', 'toro', 'husqvarna', 'bad boy', 'john deere', 'kubota', 'scag', 'exmark', 'gravely', 'cub cadet']
  const irrelevant = ['push mower', 'reel mower', 'parts only', 'for parts']
  return relevant.some(t => lower.includes(t)) && !irrelevant.some(t => lower.includes(t))
}

const BRANDS = ['Toro', 'Bad Boy', 'Husqvarna', 'John Deere', 'Kubota', 'Scag', 'Exmark', 'Gravely', 'Ferris', 'Ariens', 'Cub Cadet', 'Simplicity']

function extractMake(title: string): string | undefined {
  const upper = title.toUpperCase()
  return BRANDS.find(b => upper.includes(b.toUpperCase()))
}

function extractModel(title: string): string | undefined {
  return title.match(/\b([A-Z]{1,3}[-\s]?\d{3,5}[A-Z]?|ZT\s\w+)\b/i)?.[0]
}

function extractHours(text: string): number | undefined {
  const match = text.match(/(\d+)\s*(?:hours?|hrs?)/i)
  return match ? parseInt(match[1]) : undefined
}
