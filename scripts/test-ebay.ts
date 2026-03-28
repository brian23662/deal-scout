/**
 * Run this first to verify your eBay API credentials
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/test-ebay.ts
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function getToken(): Promise<string> {
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  })

  if (!res.ok) {
    console.error('❌ Auth failed:', await res.text())
    process.exit(1)
  }

  const data: any = await res.json()
  console.log('✅ Auth successful\n')
  return data.access_token
}

async function testFindingAPI() {
  console.log('--- Test 1: Finding API (findCompletedItems) ---')

  // Broad query — no category filter, just keywords
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID || '',
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    keywords: 'zero turn mower',
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'itemFilter(1).name': 'MinPrice',
    'itemFilter(1).value': '500',
    'paginationInput.entriesPerPage': '10',
    sortOrder: 'EndTimeSoonest',
  })

  const res = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params}`)
  const data: any = await res.json()

  const ack = data?.findCompletedItemsResponse?.[0]?.ack?.[0]
  const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || []
  const sold = items.filter((i: any) => i?.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales')

  console.log(`  ack: ${ack}`)
  console.log(`  total results: ${items.length}, sold: ${sold.length}`)

  if (items.length === 0) {
    const errorMsg = data?.findCompletedItemsResponse?.[0]?.errorMessage?.[0]?.error?.[0]?.message?.[0]
    if (errorMsg) console.log(`  eBay error: ${errorMsg}`)
    console.log('  Raw response snippet:', JSON.stringify(data).slice(0, 300))
  }

  if (sold.length > 0) {
    console.log('\n  Sample sold listings:')
    sold.slice(0, 5).forEach((item: any) => {
      const price = parseFloat(item.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.['__value__'] || '0')
      const date = item.listingInfo?.[0]?.endTime?.[0]?.split('T')[0]
      console.log(`    $${price.toFixed(0).padStart(6)}  ${date}  ${item.title?.[0]}`)
    })

    const prices = sold
      .map((i: any) => parseFloat(i.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.['__value__'] || '0'))
      .filter((p: number) => p > 0)
    const sorted = [...prices].sort((a: number, b: number) => a - b)
    const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log(`\n    Average: $${avg.toFixed(0)}  Median: $${median.toFixed(0)}  Low: $${sorted[0]}  High: $${sorted[sorted.length - 1]}`)
  }

  return sold.length > 0
}

async function testMarketplaceInsightsAPI(token: string) {
  console.log('\n--- Test 2: Marketplace Insights API (sold data) ---')

  const params = new URLSearchParams({
    q: 'zero turn mower',
    limit: '10',
  })

  const res = await fetch(
    `https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    }
  )

  const text = await res.text()

  if (!res.ok) {
    console.log(`  ❌ Status ${res.status} — this API may require additional eBay account approval`)
    console.log(`  Response: ${text.slice(0, 300)}`)
    console.log('  → App will automatically fall back to Finding API instead')
    return false
  }

  const data: any = JSON.parse(text)
  const items = data.itemSales || []
  console.log(`  ✅ Marketplace Insights works: ${items.length} sold listings returned`)

  if (items.length > 0) {
    console.log('\n  Sample sold listings:')
    items.slice(0, 5).forEach((item: any) => {
      const price = parseFloat(item.lastSoldPrice?.value || '0')
      const date = item.lastSoldDate?.split('T')[0]
      console.log(`    $${price.toFixed(0).padStart(6)}  ${date}  ${item.title}`)
    })
  }

  return true
}

async function main() {
  console.log('Testing eBay API connection...\n')

  const token = await getToken()

  const findingOk = await testFindingAPI()
  const insightsOk = await testMarketplaceInsightsAPI(token)

  console.log('\n=== Summary ===')
  console.log(`  Finding API:             ${findingOk ? '✅ working' : '⚠️  returned 0 results'}`)
  console.log(`  Marketplace Insights:    ${insightsOk ? '✅ working' : '⚠️  not available (fallback will be used)'}`)

  if (findingOk || insightsOk) {
    console.log('\n✅ eBay API is ready — at least one pricing source is working')
  } else {
    console.log('\n⚠️  Both APIs returned 0 results. Credentials are valid but check eBay account status.')
  }
}

main().catch(console.error)
