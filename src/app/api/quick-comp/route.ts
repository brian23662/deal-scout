import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { extractFromUrl } from '@/lib/extractors'
import { fetchSoldComps } from '@/lib/ebay/client'
import { filterRelevantComps } from '@/lib/ebay/relevance'
import { EbayComp, ExtractionMethod, QuickCompSoldItem } from '@/types'

// eBay's final value fee runs ~13% for most categories. Tunable via env.
const FEES_PERCENT = parseFloat(process.env.EBAY_FEES_PERCENT || '13')

/**
 * POST /api/quick-comp
 *
 * Body:
 *   { url: string }                              - auto-extract path
 *   { url: string, title: string, asking_price: number }  - manual override
 *
 * Manual override skips extraction entirely (used by the fallback form when
 * auto-extract didn't find title/price). The URL is still recorded.
 *
 * Response: the saved QuickComp row.
 */
export async function POST(request: NextRequest) {
  let body: { url?: string; title?: string; asking_price?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const url = body.url?.trim()
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'url must start with http(s)://' }, { status: 400 })
  }

  // --- 1. Extract (or accept manual values) ---
  let title: string | undefined
  let askingPrice: number | undefined
  let method: ExtractionMethod
  let sourceDomain: string

  const isManual = typeof body.title === 'string' && typeof body.asking_price === 'number'

  if (isManual) {
    title = body.title!.trim()
    askingPrice = body.asking_price!
    method = 'manual'
    try { sourceDomain = new URL(url).hostname.replace(/^www\./, '') } catch { sourceDomain = '' }
  } else {
    const extracted = await extractFromUrl(url)
    title = extracted.title
    askingPrice = extracted.asking_price
    method = extracted.extraction_method
    sourceDomain = extracted.source_domain
  }

  // If extraction didn't yield a title, we can't do comps — return early
  // with the extracted shell so the UI can show the manual form.
  if (!title || askingPrice === undefined) {
    return NextResponse.json({
      ok: false,
      needsManualEntry: true,
      extracted: {
        source_url: url,
        source_domain: sourceDomain,
        title,
        asking_price: askingPrice,
        extraction_method: method,
      },
    })
  }

  // --- 2. eBay comps ---
  let rawComps: EbayComp[] = []
  let ebayError: string | undefined
  try {
    rawComps = await fetchSoldComps(undefined, undefined, 20, title)
  } catch (err) {
    ebayError = err instanceof Error ? err.message : String(err)
    console.log('eBay fetch failed:', ebayError)
  }

  // --- 3. Relevance filter ---
  const relevantComps = filterRelevantComps(title, rawComps)

  // --- 4. Market value & profit ---
  const prices = relevantComps.map(c => c.sold_price).filter(p => p > 0).sort((a, b) => a - b)
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0
  const fees = median * (FEES_PERCENT / 100)
  const estimatedProfit = median > 0 ? Math.round(median - askingPrice - fees) : 0

  // --- 5. Persist ---
  const compsForDb: QuickCompSoldItem[] = relevantComps.slice(0, 5).map(c => ({
    title: c.title,
    price: c.sold_price,
    url: c.url,
    endedAt: c.sold_date,
  }))

  const query = buildQueryFromTitle(title)

  const { data, error } = await supabaseAdmin
    .from('quick_comps')
    .insert({
      source_url: url,
      source_domain: sourceDomain,
      title,
      asking_price: askingPrice,
      ebay_query: query,
      comps: compsForDb,
      comp_count: relevantComps.length,
      median_price: median || null,
      estimated_profit: median > 0 ? estimatedProfit : null,
      extraction_method: method,
    })
    .select()
    .single()

  if (error) {
    console.error('Supabase insert failed:', error)
    return NextResponse.json({ error: 'Failed to save lookup', details: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    row: data,
    ebayError,
  })
}

/**
 * Mirror of the query-building rule used by the eBay client, so we can
 * store what we searched for alongside the results. Keeps them auditable.
 */
function buildQueryFromTitle(title: string): string {
  const stopWords = new Set([
    'for', 'sale', 'by', 'owner', 'obo', 'or', 'best', 'offer',
    'new', 'used', 'great', 'condition', 'like', 'works', 'good',
    'the', 'and', 'with', 'very', 'must', 'see', 'price', 'firm',
    'nice', 'clean', 'runs', 'excellent', 'perfect',
  ])
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
  return words.slice(0, 4).join(' ')
}
