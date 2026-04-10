import { NextResponse } from 'next/server'

export async function GET() {
  // Test Craigslist RSS feed - stable, always includes full URLs, titles, prices
  const url = 'https://daytona.craigslist.org/search/grd?query=riding+mower&min_price=500&sort=date&format=rss'

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  })

  const text = await response.text()

  // Extract a sample of items from the RSS XML
  const items = text.match(/<item>[\s\S]*?<\/item>/g) || []
  const firstItem = items[0] || ''

  // Pull out key fields from first item
  const title = firstItem.match(/<title>(.*?)<\/title>/)?.[1] || ''
  const link = firstItem.match(/<link>(.*?)<\/link>/)?.[1] ||
               firstItem.match(/<link\s*\/?>([^<]+)/)?.[1] || ''
  const price = firstItem.match(/\$[\d,]+/)?.[0] || ''
  const enclosure = firstItem.match(/enclosure[^>]*url="([^"]+)"/)?.[1] || ''

  return NextResponse.json({
    status: response.status,
    url,
    isXml: text.startsWith('<?xml') || text.includes('<rss'),
    totalItems: items.length,
    firstItem: {
      title,
      link,
      price,
      imageUrl: enclosure,
      rawSnippet: firstItem.substring(0, 500),
    },
  })
}
