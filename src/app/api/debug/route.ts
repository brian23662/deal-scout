import { NextResponse } from 'next/server'

export async function GET() {
  // Test Craigslist's internal JSON search API
  const params = new URLSearchParams({
    query: 'riding mower',
    min_price: '500',
    sort: 'date',
    start: '0',
    limit: '5',
    cc: 'US',
    lang: 'en',
  })

  const url = `https://daytona.craigslist.org/search/api/v6/__isapi_search.api.json?${params}&cat=grd`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://daytona.craigslist.org/',
    },
  })

  const text = await response.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {}

  return NextResponse.json({
    status: response.status,
    url,
    rawSnippet: text.substring(0, 1000),
    parsed: parsed ? {
      totalCount: parsed.data?.totalCount,
      itemCount: parsed.data?.items?.length,
      firstItem: parsed.data?.items?.[0],
    } : null,
  })
}
