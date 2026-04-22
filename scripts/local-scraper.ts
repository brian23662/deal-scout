#!/usr/bin/env npx ts-node
/**
 * Deal Scout — Local Scraper
 * Runs on your Mac mini at home where Craigslist doesn't block requests.
 * Scrapes targeted categories at $500+, scores against eBay sold comps,
 * writes results directly to Supabase.
 *
 * Categories:
 *   grq — Farm & Garden (mowers, tractors, generators)
 *   app — Appliances
 *   tls — Tools
 *   bfs — Business/Commercial (pressure washers, restaurant equipment)
 *   spo — Sporting Goods
 *
 * 8 markets × 5 categories = 40 Craigslist requests per run
 *
 * eBay comps: Uses the eBay Browse API (OAuth client credentials).
 * The Finding API (findCompletedItems) was decommissioned Feb 2025.
 * Direct scraping was blocked by eBay's bot challenge (/splashui/challenge).
 *
 * Setup:
 *   1. Run manually:  npx ts-node --project tsconfig.scripts.json scripts/local-scraper.ts
 *   2. Schedule with launchd (see scripts/com.dealscout.scraper.plist)
 *   3. Requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in .env.local
 */

import * as cheerio from 'cheerio'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load env from project root .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

// ─── Config ───────────────────────────────────────────────────────────────────

const HOME_LAT = 29.2866
const HOME_LNG = -81.0559
const MIN_PRICE = 500
const MIN_PROFIT_DOLLARS = parseInt(process.env.MIN_PROFIT_DOLLARS || '600')
const MIN_PROFIT_PERCENT = parseInt(process.env.MIN_PROFIT_PERCENT || '20')
const MAX_DISTANCE_MILES = parseInt(process.env.MAX_DISTANCE_MILES || '240')

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

// ─── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface Listing {
  platform: string
  external_id: string
  title: string
  asking_price: number
  make?: string
  model?: string
  hours?: number
  location_city: string
  location_state: string
  distance_miles: number
  url: string
  image_urls: string[]
  posted_at: string
  scraped_at: string
}

interface EbayComp {
  sold_price: number
  title: string
}

// ─── Craigslist Scraper ───────────────────────────────────────────────────────

// Extract a 10-digit Craigslist post ID from any string containing it
function extractPostId(s: string): string | null {
  return s?.match(/\/(\d{10})(?:\.html)?/)?.[1] ?? null
}

async function scrapeMarket(
  market: typeof FL_MARKETS[0],
  categoryCode: string,
  categoryLabel: string
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

  // Parse JSON-LD results
  const jsonLdText = $('#ld_searchpage_results').text()
  if (!jsonLdText) {
    console.warn(`  No JSON-LD for ${market.subdomain}/${categoryLabel}`)
    return []
  }

  const jsonData = JSON.parse(jsonLdText)
  const items: any[] = jsonData?.itemListElement || []

  // Pair JSON-LD items with their listing URLs using scoped CSS selectors.
  //
  // Craigslist wraps each search result in a `li.cl-static-search-result`
  // container that holds exactly one listing anchor. This gives us a
  // guaranteed 1:1 pairing with `items[i]` — no post-ID extraction needed
  // (the JSON-LD doesn't expose post IDs anywhere), no index drift from
  // cross-market deduping, no risk of sidebar nav links polluting the index.
  //
  // Verified against tampa/grq and daytona/app via diagnose-url-alignment.ts:
  // container count matched JSON-LD count exactly, titles matched in every
  // sampled item. Previous approach (global `a[href]` scan + index pairing)
  // produced a ~63% mismatch rate in production data.
  const containers = $('li.cl-static-search-result').toArray()
  if (containers.length !== items.length) {
    console.warn(
      `  Container/JSON-LD count mismatch for ${market.subdomain}/${categoryLabel}: ` +
      `${containers.length} li.cl-static-search-result vs ${items.length} items. ` +
      `Scraping what we can.`
    )
  }

  const listings: Listing[] = []
  const seen = new Set<string>()
  const pairCount = Math.min(containers.length, items.length)

  for (let i = 0; i < pairCount; i++) {
    try {
      const element = items[i]
      const item = element?.item
      if (!item) continue

      const title: string = item.name || ''
      const price = parseFloat(item.offers?.price || '0')
      const images: string[] = Array.isArray(item.image) ? item.image : (item.image ? [item.image] : [])

      if (!price || price < MIN_PRICE) continue

      // Pull the single listing anchor from inside the scoped container.
      const container = containers[i]
      const anchor = $(container).find('a[href]')
        .filter((_, a) => /\/\d{10}\.html/.test($(a).attr('href') || ''))
        .first()
      const href = anchor.attr('href') || ''
      const postId = extractPostId(href)
      if (!postId) continue
      const itemUrl = href.startsWith('http')
        ? href
        : `https://${market.subdomain}.craigslist.org${href}`

      if (seen.has(postId)) continue
      seen.add(postId)

      listings.push({
        platform: 'craigslist',
        external_id: postId,
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

async function scrapeAllMarkets(): Promise<Listing[]> {
  const all: Listing[] = []
  const seen = new Set<string>()

  for (const market of FL_MARKETS) {
    for (const category of CL_CATEGORIES) {
      try {
        console.log(`  Scraping ${market.subdomain}/${category.label}...`)
        const listings = await scrapeMarket(market, category.code, category.label)
        for (const l of listings) {
          if (!seen.has(l.external_id)) { seen.add(l.external_id); all.push(l) }
        }
        console.log(`  ${market.subdomain}/${category.label}: ${listings.length} listings`)
      } catch (e: any) {
        console.error(`  ${market.subdomain}/${category.label} error:`, e.message)
      }
      await sleep(1500)
    }
  }

  return all
}

// ─── eBay Browse API ──────────────────────────────────────────────────────────
//
// Uses OAuth client credentials flow — no user login needed.
// Token is fetched once at startup and reused for the entire run (~2hr TTL).
// Direct scraping of ebay.com was blocked by bot challenge (/splashui/challenge).
//
// Browse API docs: https://developer.ebay.com/api-docs/buy/browse/overview.html

async function getEbayToken(): Promise<string> {
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay auth failed: HTTP ${res.status} — ${text}`)
  }

  const data = await res.json() as any
  return data.access_token
}

// ─── Spec token extraction ────────────────────────────────────────────────────
//
// Extracts the key "spec tokens" from a listing title — numbers with units,
// model numbers, and significant standalone numbers. These are used to filter
// comps so only items that share a spec token with the listing count.
//
// Examples:
//   "3.5 Ton Condenser"       → ["3.5", "ton"]
//   "Generac 7500w Generator" → ["7500", "7500w", "generac"]
//   "Husqvarna Z254 Mower"    → ["z254", "husqvarna"]

function extractSpecTokens(title: string): string[] {
  const lower = title.toLowerCase()
  const tokens = new Set<string>()

  // Numbers with units: 3.5ton, 7500w, 20hp, 48v, 60hz, 3500psi, 20gpm, etc.
  const unitPatterns = /(\d+\.?\d*)\s*(ton|hp|kw|kva|watt|w|volt|v|amp|a|psi|gpm|gal|gallon|inch|in|cc|rpm|hz|btu|seer|cu\.?\s*ft)/gi
  let m: RegExpExecArray | null
  while ((m = unitPatterns.exec(lower)) !== null) {
    tokens.add(m[1])
    tokens.add(m[1] + m[2].replace(/\s/g, ''))
  }

  // Standalone significant numbers (likely wattage, model digits, size)
  const numberPattern = /\b(\d{3,6})\b/g
  while ((m = numberPattern.exec(lower)) !== null) {
    tokens.add(m[1])
  }

  // Model numbers: letter+digit combos like Z254, XP8000E, TS248XD
  const modelPattern = /\b([a-z]{1,4}\d{2,6}[a-z]?|[a-z]?\d{2,6}[a-z]{1,4})\b/gi
  while ((m = modelPattern.exec(lower)) !== null) {
    tokens.add(m[1].toLowerCase())
  }

  // Brand names that are meaningful specs
  const specBrands = ['generac', 'honda', 'husqvarna', 'kubota', 'deere', 'toro', 'scag',
    'exmark', 'gravely', 'ferris', 'ariens', 'viking', 'miele', 'garland', 'greenlee',
    'donaldson', 'alto', 'combitherm', 'samsung', 'lg', 'bosch', 'dewalt', 'milwaukee']
  for (const brand of specBrands) {
    if (lower.includes(brand)) tokens.add(brand)
  }

  return Array.from(tokens)
}

function compMatchesListing(listingTitle: string, compTitle: string): boolean {
  const specTokens = extractSpecTokens(listingTitle)
  if (specTokens.length === 0) return true
  const compLower = compTitle.toLowerCase()
  return specTokens.some(token => compLower.includes(token))
}

async function fetchSoldComps(
  title: string,
  askingPrice: number,
  token: string,
  make?: string,
  model?: string,
): Promise<EbayComp[]> {
  const stopWords = new Set([
    'for', 'sale', 'by', 'owner', 'obo', 'or', 'best', 'offer', 'new', 'used',
    'great', 'condition', 'like', 'works', 'good', 'with', 'and', 'the', 'inch',
    'excellent', 'perfect', 'price', 'firm', 'pick', 'only', 'must', 'sell',
    'need', 'gone', 'today', 'call', 'text', 'cash', 'delivery', 'free',
    'local', 'pickup', 'available', 'brand', 'model', 'series', 'set',
  ])

  let query: string

  if (make && model) {
    query = `${make} ${model}`
  } else if (make) {
    const titleWords = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w) && w.toLowerCase() !== make.toLowerCase())
      .slice(0, 3).join(' ')
    query = `${make} ${titleWords}`
  } else {
    query = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w)).slice(0, 5).join(' ')
  }

  const minCompPrice = Math.max(100, Math.round(askingPrice * 0.25))

  const params = new URLSearchParams({
    q: query,
    filter: `buyingOptions:{AUCTION|FIXED_PRICE},soldItemsOnly:true,price:[${minCompPrice}..],priceCurrency:USD`,
    sort: 'endDateSoonest',
    limit: '50',
  })

  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    }
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay Browse API error: HTTP ${res.status} — ${text}`)
  }

  const data = await res.json() as any
  const items: any[] = data.itemSummaries || []

  const raw: EbayComp[] = items
    .map((item: any) => ({
      sold_price: parseFloat(item.price?.value || '0'),
      title: item.title || '',
    }))
    .filter(c => c.sold_price > 0 && c.title)

  const filtered = raw.filter(c => compMatchesListing(title, c.title))
  return filtered.length > 0 ? filtered : raw
}

function calculateMarketValue(comps: EbayComp[]): number {
  const prices = comps.map(c => c.sold_price).filter(p => p > 0).sort((a, b) => a - b)
  if (prices.length === 0) return 0
  return Math.round(prices[Math.floor(prices.length / 2)])
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreDeal(listing: Listing, comps: EbayComp[]) {
  const marketValue = calculateMarketValue(comps)
  const compCount = comps.length

  if (marketValue === 0 || compCount === 0) {
    return { estimated_market_value: 0, comp_count: 0, profit_potential: 0, profit_percent: 0, deal_score: 0, qualifies: false }
  }

  const profitPotential = marketValue - listing.asking_price
  const profitPercent = (profitPotential / marketValue) * 100
  const qualifies = profitPotential >= MIN_PROFIT_DOLLARS && profitPercent >= MIN_PROFIT_PERCENT && listing.distance_miles <= MAX_DISTANCE_MILES

  const score = Math.round(
    Math.min((profitPercent / 50) * 40, 40) +
    Math.min((profitPotential / 2000) * 40, 40) +
    Math.min((compCount / 20) * 20, 20)
  )

  return {
    estimated_market_value: marketValue,
    comp_count: compCount,
    profit_potential: Math.round(profitPotential),
    profit_percent: Math.round(profitPercent * 10) / 10,
    deal_score: score,
    qualifies,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Deal Scout local scraper starting...')
  console.log(`   Min price: $${MIN_PRICE} | Min profit: $${MIN_PROFIT_DOLLARS} / ${MIN_PROFIT_PERCENT}%`)
  console.log(`   Categories: ${CL_CATEGORIES.map(c => c.label).join(', ')}`)

  console.log('\n🔑 Fetching eBay API token...')
  const ebayToken = await getEbayToken()
  console.log('   ✅ Token acquired')

  const results = { scraped: 0, scored: 0, qualified: 0, skipped: 0, errors: 0, noComps: 0 }

  console.log('\n📡 Scraping Craigslist markets...')
  const listings = await scrapeAllMarkets()
  results.scraped = listings.length
  console.log(`\n✅ Scraped ${listings.length} listings total`)

  console.log('\n📊 Scoring against eBay sold comps...')
  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i]
    try {
      const { data: existing } = await supabase
        .from('scored_deals').select('id')
        .eq('platform', listing.platform)
        .eq('external_id', listing.external_id)
        .single()

      if (existing) { results.skipped++; continue }

      const comps = await fetchSoldComps(listing.title, listing.asking_price, ebayToken, listing.make, listing.model)
      const score = scoreDeal(listing, comps)
      results.scored++

      if (comps.length === 0) results.noComps++

      console.log(`  [${i + 1}/${listings.length}] "${listing.title.slice(0, 45)}..." → ${comps.length} comps | profit: $${score.profit_potential}`)

      const { error } = await supabase.from('scored_deals').insert({
        platform: listing.platform,
        external_id: listing.external_id,
        title: listing.title,
        asking_price: listing.asking_price,
        make: listing.make,
        model: listing.model,
        hours: listing.hours,
        location_city: listing.location_city,
        location_state: listing.location_state,
        distance_miles: listing.distance_miles,
        url: listing.url,
        image_urls: listing.image_urls,
        posted_at: listing.posted_at || null,
        comps: comps,
        ...score,
        status: 'new',
        alert_sent: false,
      })

      if (error) { console.error(`  DB error for ${listing.external_id}:`, error.message); results.errors++; continue }

      if (score.qualifies) {
        results.qualified++
        console.log(`  🔥 DEAL: ${listing.title} — $${score.profit_potential} profit (${score.profit_percent}%)`)
      }

      if (results.scored % 25 === 0) {
        const remaining = listings.length - i - 1 - results.skipped
        const etaMins = Math.round((remaining * 1) / 60)
        console.log(`  📊 Progress: ${results.scored} scored | ${results.noComps} no comps | ${results.qualified} qualified | ~${etaMins} min remaining`)
      }

      await sleep(500)
    } catch (e: any) {
      console.error(`  Error scoring ${listing.external_id}:`, e.message)
      results.errors++
    }
  }

  console.log('\n✅ Done!', results)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function getDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)))
}

const BRANDS = [
  'Toro', 'Bad Boy', 'Husqvarna', 'John Deere', 'Kubota', 'Scag',
  'Exmark', 'Gravely', 'Ferris', 'Ariens', 'Cub Cadet', 'Simplicity',
  'Club Car', 'EZGO', 'Yamaha', 'Honda', 'Generac', 'DeWalt', 'Milwaukee',
]
function extractMake(t: string) { return BRANDS.find(b => t.toUpperCase().includes(b.toUpperCase())) }
function extractModel(t: string) { return t.match(/\b([A-Z]{1,4}\d{2,6}[A-Z]?|\d{2,6}[A-Z]{1,4})\b/i)?.[0] }
function extractHours(t: string) { const m = t.match(/(\d+)\s*(?:hours?|hrs?)/i); return m ? parseInt(m[1]) : undefined }

main().catch(console.error)
