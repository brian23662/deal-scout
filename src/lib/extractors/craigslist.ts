import * as cheerio from 'cheerio'
import { ExtractedListing } from '@/types'
import { fetchHtml, getDomain } from './index'

/**
 * Craigslist listing detail pages embed a JSON-LD Product block.
 * Example shape:
 *   {
 *     "@context": "http://schema.org",
 *     "@type": "Product",
 *     "name": "2019 Toro TimeCutter SS5000",
 *     "offers": { "price": "2800.00", "priceCurrency": "USD", ... }
 *   }
 *
 * CL titles sometimes include the price as a suffix ("- $2,800"). We strip
 * that to keep the eBay query clean.
 */
export async function extractCraigslist(url: string): Promise<ExtractedListing> {
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)

  let title: string | undefined
  let price: number | undefined

  $('script[type="application/ld+json"]').each((_, el) => {
    if (title && price !== undefined) return
    const raw = $(el).contents().text().trim()
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      const products = Array.isArray(data) ? data : [data]
      for (const node of products) {
        if (!node || node['@type'] !== 'Product') continue
        if (!title && typeof node.name === 'string') {
          title = cleanCraigslistTitle(node.name)
        }
        const priceStr = node.offers?.price ?? node.offers?.[0]?.price
        if (price === undefined && priceStr !== undefined) {
          const parsed = parseFloat(String(priceStr))
          if (!Number.isNaN(parsed) && parsed > 0) price = parsed
        }
      }
    } catch {
      // Skip malformed JSON-LD blocks
    }
  })

  // Secondary fallback: CL detail pages show price in `.price` span
  if (price === undefined) {
    const priceText = $('.price').first().text()
    const parsed = parsePriceString(priceText)
    if (parsed !== undefined) price = parsed
  }

  // Title fallback: <title> tag, stripped of CL's "- $XXX (location)" suffix
  if (!title) {
    const pageTitle = $('title').text().trim()
    if (pageTitle) title = cleanCraigslistTitle(pageTitle)
  }

  return {
    source_url: url,
    source_domain: getDomain(url),
    title,
    asking_price: price,
    extraction_method: 'craigslist',
  }
}

function cleanCraigslistTitle(raw: string): string {
  return raw
    .replace(/\s*-\s*\$[\d,]+.*$/, '') // strip "- $2,800 (Daytona Beach)"
    .replace(/\s*\([^)]*\)\s*$/, '')   // strip trailing "(Daytona Beach)"
    .trim()
}

function parsePriceString(raw: string): number | undefined {
  if (!raw) return undefined
  const match = raw.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/)
  if (!match) return undefined
  const n = parseFloat(match[1])
  return Number.isNaN(n) || n <= 0 ? undefined : n
}
