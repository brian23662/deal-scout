import { NextResponse } from 'next/server'

export async function GET() {
  const token = process.env.APIFY_API_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'APIFY_API_TOKEN not set in environment' })
  }

  // Test the Craigslist Apify actor with a small run
  const response = await fetch(
    `https://api.apify.com/v2/acts/automation-lab~craigslist-scraper/run-sync-get-dataset-items?token=${token}&timeout=60&memory=256`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        city: 'daytona',
        category: 'for_sale',
        searchQuery: 'riding mower',
        minPrice: 500,
        maxResults: 3,
        includeDetails: false,
      }),
    }
  )

  const text = await response.text()
  let items: any[] = []
  try { items = JSON.parse(text) } catch {}

  return NextResponse.json({
    apifyStatus: response.status,
    itemCount: Array.isArray(items) ? items.length : 0,
    firstItem: Array.isArray(items) ? items[0] : null,
    rawSnippet: text.substring(0, 500),
  })
}
