/**
 * Facebook Marketplace scraper via Apify
 * Sign up at https://apify.com — add APIFY_API_TOKEN to .env
 * Cost: ~$5-15/month for our usage level
 */

import { Listing } from '@/types'
import { getDistanceMiles } from '@/lib/geo'

const HOME_LAT = 29.2866
const HOME_LNG = -81.0559
const HOME_ZIP = process.env.HOME_ZIP || '32174'
const APIFY_ACTOR_ID = 'apify/facebook-marketplace-scraper'
const APIFY_BASE = 'https://api.apify.com/v2'

interface ApifyItem {
  id: string; title: string; price: number; currency: string
  location: { city?: string; state?: string; zip?: string; latitude?: number; longitude?: number }
  url: string; images: string[]; description?: string; postedAt?: string
}

export async function scrapeMarketplace(): Promise<Listing[]> {
  const token = process.env.APIFY_API_TOKEN
  if (!token) throw new Error('APIFY_API_TOKEN not configured')

  const runResponse = await fetch(`${APIFY_BASE}/acts/${APIFY_ACTOR_ID}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ searchQuery: 'zero turn mower', location: HOME_ZIP, radiusMiles: 240, maxItems: 50, minPrice: 500 }),
  })

  if (!runResponse.ok) throw new Error(`Apify run failed: ${await runResponse.text()}`)

  const { data: run } = await runResponse.json()
  const items = await pollApifyRun(run.id, token)
  return items.map(mapApifyItem).filter(Boolean) as Listing[]
}

async function pollApifyRun(runId: string, token: string, maxWaitMs = 180000): Promise<ApifyItem[]> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 5000))
    const { data: runStatus } = await (await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token}`)).json()
    if (runStatus.status === 'SUCCEEDED') {
      return await (await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${token}&format=json`)).json()
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(runStatus.status)) throw new Error(`Apify run ${runStatus.status}`)
  }
  throw new Error('Apify run timed out')
}

function mapApifyItem(item: ApifyItem): Listing | null {
  if (!item.price || item.price < 500) return null
  const lat = item.location?.latitude
  const lng = item.location?.longitude
  return {
    platform: 'facebook',
    external_id: item.id,
    title: item.title,
    asking_price: item.price,
    make: extractMake(item.title),
    model: extractModel(item.title),
    hours: extractHours((item.title || '') + ' ' + (item.description || '')),
    location_city: item.location?.city || 'Unknown',
    location_state: item.location?.state || 'FL',
    location_zip: item.location?.zip,
    distance_miles: lat && lng ? getDistanceMiles(HOME_LAT, HOME_LNG, lat, lng) : undefined,
    url: item.url,
    image_urls: item.images || [],
    posted_at: item.postedAt,
    scraped_at: new Date().toISOString(),
  }
}

const BRANDS = ['Toro', 'Bad Boy', 'Husqvarna', 'John Deere', 'Kubota', 'Scag', 'Exmark', 'Gravely', 'Ferris', 'Ariens', 'Cub Cadet', 'Simplicity']
function extractMake(title: string): string | undefined { return BRANDS.find(b => title.toUpperCase().includes(b.toUpperCase())) }
function extractModel(title: string): string | undefined { return title.match(/\b([A-Z]{1,3}[-\s]?\d{3,5}[A-Z]?|ZT\s\w+)\b/i)?.[0] }
function extractHours(text: string): number | undefined { const m = text.match(/(\d+)\s*(?:hours?|hrs?)/i); return m ? parseInt(m[1]) : undefined }
