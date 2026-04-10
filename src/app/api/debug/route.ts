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

  // Extract URLs from anchor tags
  const urlsFromHtml: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (/\/\d{10}\.html/.test(href)) {
      const full = href.startsWith('http') ? href : `https://daytona.craigslist.org${href}`
      if (!urlsFromHtml.includes(full)) urlsFromHtml.push(full)
    }
  })

  // Parse JSON-LD
  const jsonLdText = $('#ld_searchpage_results').text()
  let parsedItems: any[] = []
  let parseError = null
  let firstItem = null

  try {
    const jsonData = JSON.parse(jsonLdText)
    parsedItems = jsonData?.itemListElement || []
    firstItem = parsedItems[0] || null
  } catch (e: any) {
    parseError = e.message
  }

  return NextResponse.json({
    status: response.status,
    jsonLdFound: !!jsonLdText,
    itemCount: parsedItems.length,
    urlsFoundInHtml: urlsFromHtml.length,
    urlSample: urlsFromHtml.slice(0, 3),
    parseError,
    firstItemTitle: firstItem?.item?.name,
    firstItemPrice: firstItem?.item?.offers?.price,
  })
}
