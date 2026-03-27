/**
 * eBay Finding API client
 * Fetches SOLD listings as market value comps
 *
 * Setup: https://developer.ebay.com
 * Create a Production app -> get Client ID and Client Secret
 */

import { EbayComp, EbayToken } from '@/types'

const EBAY_BASE_URL = process.env.EBAY_ENVIRONMENT === 'sandbox'
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com'

export const EBAY_CATEGORIES = {
  ZERO_TURN_MOWERS: '73340',
  RIDING_MOWERS: '71280',
  LAWN_TRACTORS: '46308',
  COMMERCIAL_MOWERS: '42292',
} as const

export const TARGET_BRANDS = [
  'Toro', 'Bad Boy', 'Husqvarna', 'John Deere', 'Kubota',
  'Scag', 'Exmark', 'Gravely', 'Ferris', 'Ariens', 'Cub Cadet', 'Simplicity',
] as const

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
 * Fetch sold eBay listings for market value comps
 * Primary: Marketplace Insights API
 * Fallback: Finding API (findCompletedItems)
 */
export async function fetchSoldComps(make: string, model?: string, limit = 20): Promise<EbayComp[]> {
  const token = await getEbayToken()
  const query = model ? `${make} ${model} zero turn mower` : `${make} zero turn riding mower`

  const params = new URLSearchParams({
    q: query,
    category_ids: EBAY_CATEGORIES.ZERO_TURN_MOWERS,
    limit: String(limit),
    filter: 'buyingOptions:{FIXED_PRICE},conditionIds:{3000}',
  })

  const response = await fetch(
    `${EBAY_BASE_URL}/buy/marketplace_insights/v1_beta/item_sales/search?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    console.error('eBay Marketplace Insights error, falling back to Finding API')
    return fetchSoldCompsViaFindingAPI(make, model, limit)
  }

  const data = await response.json()
  return (data.itemSales || []).map((item: any): EbayComp => ({
    ebay_item_id: item.itemId,
    title: item.title,
    make: extractMake(item.title),
    model: extractModel(item.title),
    hours: extractHours(item.title + ' ' + (item.shortDescription || '')),
    condition: item.condition?.conditionDisplayName || 'Used',
    sold_price: parseFloat(item.lastSoldPrice?.value || '0'),
    sold_date: item.lastSoldDate || new Date().toISOString(),
    url: item.itemWebUrl,
  }))
}

export async function fetchSoldCompsViaFindingAPI(make: string, model?: string, limit = 20): Promise<EbayComp[]> {
  const query = model ? `${make} ${model} zero turn` : `${make} zero turn mower`

  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID || '',
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    'keywords': query,
    'categoryId': EBAY_CATEGORIES.ZERO_TURN_MOWERS,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'itemFilter(1).name': 'MinPrice',
    'itemFilter(1).value': '500',
    'paginationInput.entriesPerPage': String(limit),
    'sortOrder': 'EndTimeSoonest',
    'outputSelector': 'SellerInfo',
  })

  const response = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params}`)
  if (!response.ok) throw new Error(`eBay Finding API error: ${response.statusText}`)

  const data = await response.json()
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

function extractMake(title: string): string | undefined {
  const upper = title.toUpperCase()
  for (const brand of TARGET_BRANDS) {
    if (upper.includes(brand.toUpperCase())) return brand
  }
  return undefined
}

function extractModel(title: string): string | undefined {
  const match = title.match(/\b([A-Z]{1,3}[-\s]?\d{3,5}[A-Z]?|ZT\s\w+|\d{2,3}"-?\d{0,2})\b/i)
  return match?.[0] || undefined
}

function extractHours(text: string): number | undefined {
  const match = text.match(/(\d+)\s*(?:hours?|hrs?)/i)
  return match ? parseInt(match[1]) : undefined
}
