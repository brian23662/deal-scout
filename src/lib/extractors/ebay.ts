import * as cheerio from 'cheerio'
import { ExtractedListing } from '@/types'
import { fetchHtml, getDomain } from './index'

/**
 * eBay listing pages include multiple JSON-LD blocks. We look for the
 * Product schema with an `offers.price` field. Auction pages store current
 * bid as the price; BIN pages store the buy-it-now price.
 */
export async function extractEbay(url: string): Promise<ExtractedListing> {
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
      const nodes = Array.isArray(data) ? data : [data]
      for (const node of nodes) {
        if (!node || node['@type'] !== 'Product') continue
        if (!title && typeof node.name === 'string') title = node.name.trim()
        const priceStr = node.offers?.price ?? node.offers?.lowPrice ?? node.offers?.[0]?.price
        if (price === undefined && priceStr !== undefined) {
          const parsed = parseFloat(String(priceStr))
          if (!Number.isNaN(parsed) && parsed > 0) price = parsed
        }
      }
    } catch {
      // Skip malformed JSON-LD
    }
  })

  // Secondary fallback: og:title / og:price meta tags
  if (!title) {
    const og = $('meta[property="og:title"]').attr('content')
    if (og) title = og.trim()
  }
  if (price === undefined) {
    const ogPrice = $('meta[property="product:price:amount"]').attr('content')
    if (ogPrice) {
      const n = parseFloat(ogPrice)
      if (!Number.isNaN(n) && n > 0) price = n
    }
  }

  return {
    source_url: url,
    source_domain: getDomain(url),
    title,
    asking_price: price,
    extraction_method: 'ebay',
  }
}
