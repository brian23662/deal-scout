/**
 * eBay Finding API client
 * Fetches SOLD listings as market value comps
 * Now title-driven: builds search query from listing title words
 * so it works for any category (mowers, golf carts, trailers, tools, etc.)
 */

import { EbayComp, EbayToken } from '@/types'

const EBAY_BASE_URL = process.env.EBAY_ENVIRONMENT === 'sandbox'
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com'

let cachedToken: { token: string; expiresAt: number } | null = null

export async function getEbayToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300000) return cachedToken.token

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64')

  const response = await fetch(`${EBAY_BASE_URL}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  })

  if (!response.ok) throw new Error(`eBay auth failed: ${await response.text()}`)

  const data: EbayToken = await response.json()
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cachedToken.token
}

/**
 * Build an eBay search query from a listing title.
 * Extracts the most meaningful 4-5 words so we get relevant comps
 * regardless of category (mowers, golf carts, trailers, tools, etc.)
 */
export function buildEbayQuery(title: string, make?: string, model?: string): string {
  if (make && model) return `${make} ${model}`
  if (make) return `${make} ${title.split(' ').slice(0, 3).join(' ')}`

  // Strip common filler words and take the first 5 meaningful words
  const stopWords = new Set(['for', 'sale', 'by', 'owner', 'obo', 'or', 'best', 'offer', 'new', 'used', 'great', 'condition', 'like', 'works', 'good'])
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 5)

  return words.join(' ')
}

/**
 * Fetch sold eBay listings for market value comps
 * Uses Finding API (findCompletedItems) — no special approval required
 */
export async function fetchSoldComps(make: string | undefined, model: string | undefined, limit = 20, title?: string): Promise<EbayComp[]> {
  const query = buildEbayQuery(title || make || 'used equipment', make, model)
  console.log(`eBay query: "${query}" for listing: "${title?.substring(0, 50)}"`)

  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID || '',
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    'keywords': query,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'itemFilter(1).name': 'MinPrice',
    'itemFilter(1).value': '100',
    'paginationInput.entriesPerPage': String(limit),
    'sortOrder': 'EndTimeSoonest',
  })

  const response = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params}`)
  if (!response.ok) throw new Error(`eBay Finding API error: ${response.statusText}`)

  const data = await response.json()

  // Handle rate limit error shape
  if (data?.errorMessage) {
    throw new Error(`eBay API error: ${JSON.stringify(data.errorMessage)}`)
  }

  const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || []

  return items
    .filter((item: any) => item?.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')
    .map((item: any): EbayComp => ({
      ebay_item_id: item.itemId?.[0] || '',
      title: item.title?.[0] || '',
      make: extractMake(item.title?.[0] || ''),
      model: extractModel(item.title?.[0] || ''),
      hours: extractHours(item.title?.[0] || ''),
      condition: item.condition?.[0]?.conditionDisplayName?.[0] || 'Used',
      sold_price: parseFloat(item.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.['__value__'] || '0'),
      sold_date: item.listingInfo?.[0]?.endTime?.[0] || new Date().toISOString(),
      url: item.viewItemURL?.[0] || '',
    }))
}

export function calculateMarketValue(comps: EbayComp[]): {
  marketValue: number; median: number; average: number; low: number; high: number; sampleSize: number
} {
  if (comps.length === 0) return { marketValue: 0, median: 0, average: 0, low: 0, high: 0, sampleSize: 0 }

  const prices = comps.map(c => c.sold_price).filter(p => p > 0).sort((a, b) => a - b)
  const trimCount = prices.length >= 10 ? Math.floor(prices.length * 0.1) : 0
  const trimmed = prices.slice(trimCount, prices.length - trimCount)
  const average = trimmed.reduce((sum, p) => sum + p, 0) / trimmed.length
  const median = trimmed[Math.floor(trimmed.length / 2)]

  return {
    marketValue: Math.round(median),
    median: Math.round(median),
    average: Math.round(average),
    low: Math.round(prices[0]),
    high: Math.round(prices[prices.length - 1]),
    sampleSize: comps.length,
  }
}

const TARGET_BRANDS = ['Toro', 'Bad Boy', 'Husqvarna', 'John Deere', 'Kubota', 'Scag', 'Exmark', 'Gravely', 'Ferris', 'Ariens', 'Cub Cadet', 'Simplicity', 'Club Car', 'EZGO', 'Yamaha', 'Big Tex', 'Load Trail']

function extractMake(title: string): string | undefined {
  return TARGET_BRANDS.find(b => title.toUpperCase().includes(b.toUpperCase()))
}

function extractModel(title: string): string | undefined {
  return title.match(/\b([A-Z]{1,3}[-\s]?\d{3,5}[A-Z]?|ZT\s\w+)\b/i)?.[0]
}

function extractHours(text: string): number | undefined {
  const m = text.match(/(\d+)\s*(?:hours?|hrs?)/i)
  return m ? parseInt(m[1]) : undefined
}
