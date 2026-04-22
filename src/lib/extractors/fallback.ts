import * as cheerio from 'cheerio'
import { ExtractedListing, ExtractionMethod } from '@/types'
import { fetchHtml, getDomain } from './index'

/**
 * Site-agnostic fallback. Tries OpenGraph first (widely supported on
 * e-commerce pages), then generic schema.org Product JSON-LD. If neither
 * yields both title and price, returns whatever we did find so the caller
 * can still show partial results.
 *
 * `extraction_method` reflects which source we got it from, so the DB
 * records where the data came from for debugging.
 */
export async function extractFallback(url: string): Promise<ExtractedListing> {
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)

  let title: string | undefined
  let price: number | undefined
  let method: ExtractionMethod = 'opengraph'

  // OpenGraph
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim()
  if (ogTitle) title = ogTitle

  const ogPrice = $('meta[property="product:price:amount"]').attr('content')
    ?? $('meta[property="og:price:amount"]').attr('content')
    ?? $('meta[itemprop="price"]').attr('content')
  if (ogPrice) {
    const n = parseFloat(ogPrice)
    if (!Number.isNaN(n) && n > 0) price = n
  }

  // Fall through to JSON-LD if OG didn't give us both
  if (!title || price === undefined) {
    $('script[type="application/ld+json"]').each((_, el) => {
      if (title && price !== undefined) return
      try {
        const data = JSON.parse($(el).contents().text())
        const nodes = Array.isArray(data) ? data : [data]
        for (const node of nodes) {
          if (!node) continue
          // Walk @graph arrays too — common in WordPress / Yoast schemas
          const candidates = Array.isArray(node['@graph']) ? node['@graph'] : [node]
          for (const c of candidates) {
            if (!c) continue
            if (c['@type'] === 'Product' || (Array.isArray(c['@type']) && c['@type'].includes('Product'))) {
              if (!title && typeof c.name === 'string') {
                title = c.name.trim()
                method = 'jsonld'
              }
              const priceStr = c.offers?.price ?? c.offers?.lowPrice ?? c.offers?.[0]?.price
              if (price === undefined && priceStr !== undefined) {
                const parsed = parseFloat(String(priceStr))
                if (!Number.isNaN(parsed) && parsed > 0) {
                  price = parsed
                  method = 'jsonld'
                }
              }
            }
          }
        }
      } catch {}
    })
  }

  // Last-ditch: <title> tag
  if (!title) {
    const t = $('title').text().trim()
    if (t) title = t
  }

  return {
    source_url: url,
    source_domain: getDomain(url),
    title,
    asking_price: price,
    extraction_method: method,
  }
}
