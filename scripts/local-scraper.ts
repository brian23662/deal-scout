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
 * eBay comps: Scrapes ebay.com sold listings directly (no API key needed).
 * The Finding API (findCompletedItems) was decommissioned Feb 2025.
 *
 * Setup:
 *   1. Run manually:  npx ts-node --project tsconfig.scripts.json scripts/local-scraper.ts
 *   2. Schedule with launchd (see scripts/com.dealscout.scraper.plist)
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

  // Also grab URLs from anchor tags (JSON-LD omits them)
  const urls: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (/\/\d{10}\.html/.test(href)) {
      const full = href.startsWith('http') ? href : `https://${market.subdomain}.craigslist.org${href}`
      if (!urls.includes(full)) urls.push(full)
    }
  })

  const listings: Listing[] = []
  for (let i = 0; i < items.length; i++) {
    try {
      const item = items[i]?.item
      if (!item) continue

      const title: string = item.name || ''
      const price = parseFloat(item.offers?.price || '0')
      const images: string[] = Array.isArray(item.image) ? item.image : (item.image ? [item.image] : [])
      const itemUrl = urls[i] || ''

      if (!price || price < MIN_PRICE) continue
      if (!itemUrl) continue

      const externalId = itemUrl.match(/\/(\d{10})\.html/)?.[1]
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

// ─── eBay Sold Comps (scraped from ebay.com — no API key needed) ─────────────
//
// The Finding API (findCompletedItems) was decommissioned in Feb 2025.
// Instead, we scrape the public sold listings search page on ebay.com.
// This returns the same data: item title + sold price.
//
// Key improvements over v1:
// - Min comp price set to 25% of asking price (filters out parts/accessories)
// - Better query construction to find whole items, not parts
// - Progress logging every 25 listings

async function fetchSoldComps(title: string, askingPrice: number, make?: string, model?: string): Promise<EbayComp[]> {
  // Build a search query from the listing title
  const stopWords = new Set([
    'for', 'sale', 'by', 'owner', 'obo', 'or', 'best', 'offer', 'new', 'used',
    'great', 'condition', 'like', 'works', 'good', 'with', 'and', 'the', 'inch',
    'excellent', 'perfect', 'price', 'firm', 'pick', 'only', 'must', 'sell',
    'need', 'gone', 'today', 'call', 'text', 'cash', 'delivery', 'free',
    'local', 'pickup', 'available', 'brand', 'model', 'series', 'set',
  ])

  let query: string

  if (make && model) {
    // Best case: we know the brand and model
    query = `${make} ${model}`
  } else if (make) {
    // We know the brand — grab a few meaningful words from the title
    const titleWords = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w) && w.toLowerCase() !== make.toLowerCase())
      .slice(0, 3).join(' ')
    query = `${make} ${titleWords}`
  } else {
    // No brand detected — use the most meaningful words from the title
    query = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w)).slice(0, 5).join(' ')
  }

  // Set min comp price to 25% of asking price — filters out parts/accessories
  // e.g., if asking $4500, only show sold items $1125+
  const minCompPrice = Math.max(100, Math.round(askingPrice * 0.25))

  const params = new URLSearchParams({
    _nkw: query,
    LH_Complete: '1',   // Completed listings
    LH_Sold: '1',       // Sold only
    _udlo: String(minCompPrice),  // Dynamic min price based on asking
    _ipg: '60',          // Up to 60 results per page
    rt: 'nc',
    _sop: '13',          // Sort by end date: newest first
  })

  const url = `https://www.ebay.com/sch/i.html?${params}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })

  if (!response.ok) {
    throw new Error(`eBay search failed: HTTP ${response.status} for query "${query}"`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  const comps: EbayComp[] = []
  $('li.s-card').each((_, el) => {
    const item = $(el)
    const text = item.text()

    // Skip non-sold items (sponsored ads, etc.)
    if (!text.includes('Sold')) return

    const compTitle = (item.find('[role="heading"]').first().text() || '')
      .replace(/Opens in.*/, '').trim()
    const priceText = item.find('.s-card__price').text().trim()
    const price = parseFloat(priceText.replace(/[^0-9.]/g, ''))

    if (compTitle && price > 0) {
      comps.push({ sold_price: price, title: compTitle })
    }
  })

  return comps
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
  console.log(`   eBay comps: scraping sold listings (no API key needed)`)

  const results = { scraped: 0, scored: 0, qualified: 0, skipped: 0, errors: 0, noComps: 0 }

  console.log('\n📡 Scraping Craigslist markets...')
  const listings = await scrapeAllMarkets()
  results.scraped = listings.length
  console.log(`\n✅ Scraped ${listings.length} listings total`)

  console.log('\n📊 Scoring against eBay sold comps...')
  const startTime = Date.now()
  for (let i = 0; i < listings.length; i++) {
    const listing = listings[i]
    try {
      const { data: existing } = await supabase
        .from('scored_deals').select('id')
        .eq('platform', listing.platform)
        .eq('external_id', listing.external_id)
        .single()

      if (existing) { results.skipped++; continue }

      const comps = await fetchSoldComps(listing.title, listing.asking_price, listing.make, listing.model)
      const score = scoreDeal(listing, comps)
      results.scored++

      if (comps.length === 0) results.noComps++

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
        ...score,
        status: 'new',
        alert_sent: false,
      })

      if (error) { console.error(`  DB error for ${listing.external_id}:`, error.message); results.errors++; continue }

      if (score.qualifies) {
        results.qualified++
        console.log(`  🔥 DEAL: ${listing.title} — $${score.profit_potential} profit (${score.profit_percent}%)`)
      }

      // Progress log every 25 listings
      if (results.scored % 25 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000)
        const remaining = listings.length - i - 1 - results.skipped
        const etaMins = Math.round((remaining * 2) / 60)
        console.log(`  📊 Progress: ${results.scored} scored | ${results.noComps} no comps | ${comps.length} comps this one | ${results.qualified} qualified | ~${etaMins} min remaining`)
      }

      // 2-second delay between eBay requests — polite scraping
      await sleep(2000)
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
function extractModel(t: string) { return t.match(/\b([A-Z]{1,3}[-\s]?\d{3,5}[A-Z]?|ZT\s\w+)\b/i)?.[0] }
function extractHours(t: string) { const m = t.match(/(\d+)\s*(?:hours?|hrs?)/i); return m ? parseInt(m[1]) : undefined }

main().catch(console.error)
