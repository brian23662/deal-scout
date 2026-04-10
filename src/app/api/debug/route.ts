import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

export async function GET() {
  const url = 'https://daytona.craigslist.org/search/grd?query=riding+mower&min_price=500&sort=date'

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })

  const html = await response.text()
  const $ = cheerio.load(html)

  // Try various selectors to find what Craigslist is using now
  const results = {
    status: response.status,
    url,
    selectors: {
      'li.cl-search-result': $('li.cl-search-result').length,
      'li.result-row': $('li.result-row').length,
      '.cl-search-result': $('.cl-search-result').length,
      '[data-pid]': $('[data-pid]').length,
      '.posting-title': $('.posting-title').length,
      'a.posting-title': $('a.posting-title').length,
      '.result-title': $('.result-title').length,
      'li': $('li').length,
    },
    // Grab first 2000 chars of body to see structure
    bodySnippet: html.substring(0, 2000),
  }

  return NextResponse.json(results, { headers: { 'Content-Type': 'application/json' } })
}
