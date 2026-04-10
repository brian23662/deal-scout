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
    url,
    jsonLdFound: !!jsonLdText,
    jsonLdLength: jsonLdText?.length || 0,
    itemCount: parsedItems.length,
    parseError,
    firstItem, // full structure of the first listing so we can see field names
  })
}
