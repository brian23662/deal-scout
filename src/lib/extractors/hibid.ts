import * as cheerio from 'cheerio'
import { ExtractedListing } from '@/types'
import { fetchHtml, getDomain } from './index'

/**
 * HiBid (general online auction network). Same defensive approach as govdeals:
 * JSON-LD → OpenGraph → common selectors. Without stable contract docs we
 * treat any hit as good-enough and rely on the generic fallback downstream.
 */
export async function extractHiBid(url: string): Promise<ExtractedListing> {
  const html = await fetchHtml(url)
  const $ = cheerio.load(html)

  let title: string | undefined
  let price: number | undefined

  $('script[type="application/ld+json"]').each((_, el) => {
    if (title && price !== undefined) return
    try {
      const data = JSON.parse($(el).contents().text())
      const nodes = Array.isArray(data) ? data : [data]
      for (const node of nodes) {
        if (!node) continue
        if (!title && typeof node.name === 'string') title = node.name.trim()
        const priceStr = node.offers?.price ?? node.offers?.lowPrice ?? node.offers?.[0]?.price
        if (price === undefined && priceStr !== undefined) {
          const parsed = parseFloat(String(priceStr))
          if (!Number.isNaN(parsed) && parsed > 0) price = parsed
        }
      }
    } catch {}
  })

  if (!title) title = $('meta[property="og:title"]').attr('content')?.trim() || undefined
  if (price === undefined) {
    const og = $('meta[property="product:price:amount"]').attr('content')
    if (og) {
      const n = parseFloat(og)
      if (!Number.isNaN(n) && n > 0) price = n
    }
  }

  if (!title) {
    for (const sel of ['h1.lot-title', '.lot-title', 'h1.title', 'h1']) {
      const t = $(sel).first().text().trim()
      if (t) { title = t; break }
    }
  }
  if (price === undefined) {
    for (const sel of ['.current-bid', '.high-bid', '.price', '.bid-amount']) {
      const n = parseMoney($(sel).first().text())
      if (n !== undefined) { price = n; break }
    }
  }

  return {
    source_url: url,
    source_domain: getDomain(url),
    title,
    asking_price: price,
    extraction_method: 'hibid',
  }
}

function parseMoney(raw: string): number | undefined {
  if (!raw) return undefined
  const m = raw.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/)
  if (!m) return undefined
  const n = parseFloat(m[1])
  return Number.isNaN(n) || n <= 0 ? undefined : n
}
