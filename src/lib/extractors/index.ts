import { ExtractedListing } from '@/types'
import { extractCraigslist } from './craigslist'
import { extractEbay } from './ebay'
import { extractGovDeals } from './govdeals'
import { extractHiBid } from './hibid'
import { extractFallback } from './fallback'

/**
 * Realistic User-Agent to reduce the chance of bot detection.
 * Some sites (govdeals in particular) block the default Node UA.
 */
export const FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' })
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`)
  return await res.text()
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Main entry: given a URL, dispatch to the right site-specific extractor,
 * falling back to generic OpenGraph / JSON-LD if the site match fails
 * or produces no data.
 *
 * Always returns an `ExtractedListing` — if everything fails, title and
 * asking_price will be undefined and the UI shows a manual form.
 */
export async function extractFromUrl(url: string): Promise<ExtractedListing> {
  const domain = getDomain(url)

  // Site dispatch — order matters, most specific first
  try {
    if (domain.includes('craigslist.org')) {
      const result = await extractCraigslist(url)
      if (result.title && result.asking_price !== undefined) return result
    }
    if (domain.includes('ebay.com')) {
      const result = await extractEbay(url)
      if (result.title && result.asking_price !== undefined) return result
    }
    if (domain.includes('govdeals.com')) {
      const result = await extractGovDeals(url)
      if (result.title && result.asking_price !== undefined) return result
    }
    if (domain.includes('hibid.com')) {
      const result = await extractHiBid(url)
      if (result.title && result.asking_price !== undefined) return result
    }
  } catch (err) {
    console.log(`Site-specific extractor failed for ${domain}:`, err instanceof Error ? err.message : err)
  }

  // Generic fallback chain (OpenGraph → JSON-LD)
  try {
    const fallback = await extractFallback(url)
    if (fallback.title || fallback.asking_price !== undefined) return fallback
  } catch (err) {
    console.log(`Fallback extractor failed for ${domain}:`, err instanceof Error ? err.message : err)
  }

  // Everything failed — return the bare URL for manual entry
  return {
    source_url: url,
    source_domain: domain,
    extraction_method: 'manual',
  }
}
