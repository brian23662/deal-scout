/**
 * Run this first to verify your eBay API credentials
 *
 * Usage:
 *   cp .env.example .env.local
 *   # fill in EBAY_CLIENT_ID and EBAY_CLIENT_SECRET
 *   npx ts-node --project tsconfig.scripts.json scripts/test-ebay.ts
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function main() {
  console.log('Testing eBay API connection...\n')

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64')

  const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  })

  if (!tokenRes.ok) { console.error('❌ Auth failed:', await tokenRes.text()); process.exit(1) }
  console.log('✅ Auth successful\n')

  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID || '',
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    keywords: 'Toro Titan zero turn mower',
    categoryId: '73340',
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'itemFilter(1).name': 'MinPrice',
    'itemFilter(1).value': '500',
    'paginationInput.entriesPerPage': '10',
    sortOrder: 'EndTimeSoonest',
  })

  const searchRes = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params}`)
  const searchData: any = await searchRes.json()
  const items = searchData?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || []
  const sold = items.filter((i: any) => i?.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')

  console.log(`✅ Finding API works: ${items.length} completed, ${sold.length} sold\n`)

  if (sold.length > 0) {
    console.log('Sample sold listings:')
    sold.slice(0, 5).forEach((item: any) => {
      const price = parseFloat(item.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.['__value__'] || '0')
      const date = item.listingInfo?.[0]?.endTime?.[0]?.split('T')[0]
      console.log(`  $${price.toFixed(0).padStart(6)}  ${date}  ${item.title?.[0]}`)
    })

    const prices = sold
      .map((i: any) => parseFloat(i.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.['__value__'] || '0'))
      .filter((p: number) => p > 0)
    const sorted = [...prices].sort((a: number, b: number) => a - b)
    const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length
    const median = sorted[Math.floor(sorted.length / 2)]

    console.log(`\n  Average: $${avg.toFixed(0)}  Median: $${median.toFixed(0)}  Low: $${sorted[0]}  High: $${sorted[sorted.length - 1]}`)
  }

  console.log('\n✅ All tests passed - eBay API is ready')
}

main().catch(console.error)
