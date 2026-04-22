#!/usr/bin/env npx ts-node
/**
 * Deal Scout — URL alignment diagnostic
 *
 * Fetches ONE Craigslist market/category and inspects the raw data that
 * the scraper uses to pair JSON-LD listings with their anchor-tag URLs.
 *
 * Purpose: figure out why ~63% of scraped listings end up with mismatched
 * URLs, and prove out the fix before editing the scraper.
 *
 * Run from the repo root:
 *   npx ts-node --project tsconfig.scripts.json scripts/diagnose-url-alignment.ts
 *
 * Optional: pass market + category:
 *   npx ts-node --project tsconfig.scripts.json scripts/diagnose-url-alignment.ts tampa grq
 *
 * No DB writes, no eBay calls. Safe to run anytime.
 */

import * as cheerio from 'cheerio'

const MARKET = process.argv[2] || 'tampa'
const CATEGORY = process.argv[3] || 'grq'

async function main() {
  const url = `https://${MARKET}.craigslist.org/search/${CATEGORY}?min_price=500&sort=date`
  console.log(`\n=== Fetching ${url} ===\n`)

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })

  if (!res.ok) {
    console.error(`HTTP ${res.status}`)
    process.exit(1)
  }

  const html = await res.text()
  console.log(`HTML size: ${(html.length / 1024).toFixed(1)} KB\n`)

  const $ = cheerio.load(html)

  // ---------- 1. JSON-LD content ----------
  const jsonLdText = $('#ld_searchpage_results').text()
  if (!jsonLdText) {
    console.error('No #ld_searchpage_results block found.')
    process.exit(1)
  }
  const jsonData = JSON.parse(jsonLdText)
  const items: any[] = jsonData?.itemListElement || []
  console.log(`JSON-LD itemListElement count: ${items.length}\n`)

  // ---------- 2. Dump the first 5 items' raw structure ----------
  console.log('=== FIRST 5 ITEMS (raw JSON-LD fields) ===\n')
  for (let i = 0; i < Math.min(5, items.length); i++) {
    const el = items[i]
    const item = el?.item
    console.log(`--- Item ${i} ---`)
    console.log(`  element.url       : ${stringify(el?.url)}`)
    console.log(`  element['@id']    : ${stringify(el?.['@id'])}`)
    console.log(`  element.position  : ${stringify(el?.position)}`)
    console.log(`  item.name         : ${truncate(item?.name, 80)}`)
    console.log(`  item.url          : ${stringify(item?.url)}`)
    console.log(`  item['@id']       : ${stringify(item?.['@id'])}`)
    console.log(`  item.offers.price : ${stringify(item?.offers?.price)}`)
    console.log(`  item.image[0]     : ${truncate(Array.isArray(item?.image) ? item.image[0] : item?.image, 80)}`)
    console.log()
  }

  // ---------- 3. Post ID extraction success rate per field ----------
  console.log('=== POST ID EXTRACTION SUCCESS RATE (across all items) ===\n')
  const fieldStats = {
    'element.url': 0,
    'element[@id]': 0,
    'item.url': 0,
    'item[@id]': 0,
    'item.image[0]': 0,
    'any field': 0,
  }
  for (const el of items) {
    const item = el?.item || {}
    const got = {
      'element.url': !!extractPostId(el?.url),
      'element[@id]': !!extractPostId(el?.['@id']),
      'item.url': !!extractPostId(item?.url),
      'item[@id]': !!extractPostId(item?.['@id']),
      'item.image[0]': !!extractPostId(Array.isArray(item?.image) ? item.image[0] : item?.image),
    }
    for (const k of Object.keys(got) as (keyof typeof got)[]) {
      if (got[k]) fieldStats[k]++
    }
    if (Object.values(got).some(v => v)) fieldStats['any field']++
  }
  for (const [k, v] of Object.entries(fieldStats)) {
    const pct = items.length ? ((v / items.length) * 100).toFixed(0) : '0'
    console.log(`  ${k.padEnd(18)}: ${v}/${items.length} (${pct}%)`)
  }
  console.log()

  // ---------- 4. Anchor tag landscape ----------
  console.log('=== ANCHOR TAG ANALYSIS ===\n')
  const allAnchors: string[] = []
  const listingIdAnchors: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    allAnchors.push(href)
    if (/\/\d{10}\.html/.test(href)) listingIdAnchors.push(href)
  })
  console.log(`  Total <a href> on page           : ${allAnchors.length}`)
  console.log(`  Anchors matching /NNNNNNNNNN.html: ${listingIdAnchors.length}`)
  console.log(`  Unique post IDs among them       : ${new Set(listingIdAnchors.map(h => h.match(/\/(\d{10})\.html/)?.[1])).size}`)

  // ---------- 5. Scoped selectors — find a container that wraps exactly one listing ----------
  console.log('\n=== SCOPED SELECTOR CANDIDATES ===\n')
  const candidates = [
    'li.cl-static-search-result',
    'li.cl-search-result',
    'div.cl-search-result',
    'div.result-row',
    'li.result-row',
    '.gallery-card',
    '.cl-gallery',
    '[class*="search-result"]',
  ]
  for (const sel of candidates) {
    const els = $(sel)
    if (els.length === 0) continue
    // How many anchors to 10-digit post IDs inside each?
    let withOneAnchor = 0
    let withMultipleAnchors = 0
    let withZeroAnchors = 0
    els.each((_, el) => {
      const hrefs = $(el).find('a[href]').map((_, a) => $(a).attr('href') || '').get()
      const listing = hrefs.filter(h => /\/\d{10}\.html/.test(h))
      if (listing.length === 0) withZeroAnchors++
      else if (listing.length === 1) withOneAnchor++
      else withMultipleAnchors++
    })
    console.log(`  ${sel.padEnd(35)} found=${String(els.length).padEnd(4)} ✓1=${withOneAnchor} ✗0=${withZeroAnchors} ⚠️>1=${withMultipleAnchors}`)
  }

  // ---------- 6. If a good scoped selector exists, show 5 samples ----------
  console.log('\n=== SAMPLE SCOPED MATCH (first candidate with count ≈ JSON-LD count) ===\n')
  for (const sel of candidates) {
    const els = $(sel)
    if (els.length === 0) continue
    if (Math.abs(els.length - items.length) > 5) continue
    console.log(`  Using selector: ${sel}\n`)
    els.slice(0, 5).each((i, el) => {
      const $el = $(el)
      const firstAnchor = $el.find('a[href]').first().attr('href') || ''
      const titleGuess = $el.find('a').first().text().trim() || $el.text().replace(/\s+/g, ' ').trim().slice(0, 80)
      console.log(`  [${i}] title-guess: ${truncate(titleGuess, 80)}`)
      console.log(`      anchor     : ${truncate(firstAnchor, 120)}`)
      console.log(`      jsonld name: ${truncate(items[i]?.item?.name, 80)}`)
      console.log(`      match?     : ${compareLoose(titleGuess, items[i]?.item?.name || '')}\n`)
    })
    break
  }

  console.log('=== END ===\n')
}

function extractPostId(s: any): string | null {
  if (typeof s !== 'string') return null
  return s.match(/\/(\d{10})(?:\.html)?/)?.[1] ?? null
}

function stringify(v: any): string {
  if (v === undefined) return '(undefined)'
  if (v === null) return '(null)'
  if (typeof v === 'string') return v.length > 120 ? v.slice(0, 120) + '...' : v
  return JSON.stringify(v)
}

function truncate(s: any, n: number): string {
  if (typeof s !== 'string') return stringify(s)
  return s.length > n ? s.slice(0, n) + '...' : s
}

function compareLoose(a: string, b: string): string {
  if (!a || !b) return 'no data'
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).slice(0, 4).join(' ')
  return norm(a) === norm(b) ? 'YES (first 4 words match)' : `DIFFERENT — "${norm(a)}" vs "${norm(b)}"`
}

main().catch(err => { console.error(err); process.exit(1) })
