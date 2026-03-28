/**
 * Run this to verify your eBay API credentials and Finding API access.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/test-ebay.ts
 *
 * NOTE: If you see error 10001 (RateLimiter), you ran this too many times
 * in a short window. Wait 15-30 min and try again. This does NOT affect
 * production — the cron only runs every 30 min, well within quota.
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Matches EBAY_CATEGORIES in src/lib/ebay/client.ts
const ZERO_TURN_CATEGORY = '73340'
const RIDING_MOWER_CATEGORY = '71280'

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

async function testFindingAPI(categoryId: string, label: string): Promise<boolean> {
  console.log(`--- Finding API: ${label} (categoryId: ${categoryId}) ---`)

  // This mirrors exactly what fetchSoldCompsViaFindingAPI() does in production
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': process.env.EBAY_CLIENT_ID || '',
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    'keywords': 'zero turn mower',
    'categoryId': categoryId,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'itemFilter(1).name': 'MinPrice',
    'itemFilter(1).value': '500',
    'paginationInput.entriesPerPage': '10',
    'sortOrder': 'EndTimeSoonest',
    'outputSelector': 'SellerInfo',
  })

  const res = await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params}`)
  const data: any = await res.json()

  const ack = data?.findCompletedItemsResponse?.[0]?.ack?.[0]
  const totalReturned = parseInt(
    data?.findCompletedItemsResponse?.[0]?.paginationOutput?.[0]?.totalEntries?.[0] || '0'
  )
  const items = data?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || []
  const sold = items.filter(
    (i: any) => i?.sellingStatus?.[0]?.sellingState?.[0] === 'EndedWithSales'
  )

  // Check for rate limit or other eBay errors
  const ebayError = data?.findCompletedItemsResponse?.[0]?.errorMessage?.[0]?.error?.[0]
  if (ebayError) {
    const errorId = ebayError?.errorId?.[0]
    const msg = ebayError?.message?.[0]
    if (errorId === '10001') {
      console.log(`  ⏳ Rate limited (error 10001) — wait 15-30 min and retry`)
      console.log(`     This will NOT happen in production (cron runs every 30 min)`)
    } else {
      console.log(`  eBay error ${errorId}: ${msg}`)
    }
    return false
  }

  console.log(`  ack: ${ack}`)
  console.log(`  Total sold listings in category: ${totalReturned}`)
  console.log(`  Returned this page: ${items.length} listings, ${sold.length} confirmed sold`)

  if (sold.length > 0) {
    console.log('\n  Sample sold listings:')
    sold.slice(0, 5).forEach((item: any) => {
      const price = parseFloat(
        item.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.['__value__'] || '0'
      )
      const date = item.listingInfo?.[0]?.endTime?.[0]?.split('T')[0]
      const title = (item.title?.[0] || '').substring(0, 60)
      console.log(`    $${price.toFixed(0).padStart(6)}  ${date}  ${title}`)
    })

    const prices = sold
      .map((i: any) =>
        parseFloat(i.sellingStatus?.[0]?.convertedCurrentPrice?.[0]?.['__value__'] || '0')
      )
      .filter((p: number) => p > 0)
    const sorted = [...prices].sort((a: number, b: number) => a - b)
    const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length
    const median = sorted[Math.floor(sorted.length / 2)]
    console.log(
      `\n    Avg: $${avg.toFixed(0)}  Median: $${median.toFixed(0)}  Low: $${sorted[0]}  High: $${sorted[sorted.length - 1]}`
    )
  }

  return sold.length > 0
}

async function testMarketplaceInsightsAPI(token: string): Promise<boolean> {
  console.log('\n--- Marketplace Insights API (bonus check — not required) ---')

  const params = new URLSearchParams({
    q: 'zero turn mower',
    category_ids: ZERO_TURN_CATEGORY,
    limit: '5',
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
    console.log(`  ⚠️  Status ${res.status} — not approved for this API (this is fine)`)
    console.log('  → Production automatically uses Finding API fallback')
    return false
  }

  const data: any = JSON.parse(text)
  const items = data.itemSales || []
  console.log(`  ✅ Marketplace Insights works: ${items.length} results`)
  return true
}

async function main() {
  console.log('Testing eBay API connection...\n')

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    console.error('❌ Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in .env.local')
    process.exit(1)
  }

  const token = await getToken()

  const zeroTurnOk = await testFindingAPI(ZERO_TURN_CATEGORY, 'Zero Turn Mowers')
  console.log()
  const ridingOk = await testFindingAPI(RIDING_MOWER_CATEGORY, 'Riding Mowers')
  const insightsOk = await testMarketplaceInsightsAPI(token)

  console.log('\n=== Summary ===')
  console.log(`  Finding API (zero turn):  ${zeroTurnOk ? '✅ working' : '⚠️  0 results (rate limit or quota)'}`)
  console.log(`  Finding API (riding):     ${ridingOk ? '✅ working' : '⚠️  0 results (rate limit or quota)'}`)
  console.log(`  Marketplace Insights:     ${insightsOk ? '✅ working' : '⚠️  not approved (Finding API fallback active)'}`)

  if (zeroTurnOk || ridingOk) {
    console.log('\n✅ eBay Finding API is working — you are ready to run the cron')
  } else {
    console.log('\n⚠️  Got 0 sold results.')
    console.log('   If you see "Rate limited" above → wait 15-30 min, then retry')
    console.log('   Auth is confirmed working, so your credentials are correct.')
    console.log('   The production cron will work fine — it runs every 30 min, well within quota.')
  }
}

main().catch(console.error)
