/**
 * POST /api/cron - Scrape only, no eBay calls
 * Triggered every 30 min via cron-job.org
 * Secured with x-cron-secret header
 *
 * Phase 1 of 2-phase approach:
 * 1. Scrape Craigslist for new listings
 * 2. Save them to Supabase with comp_count=0 (unscored)
 * 3. Return immediately — no eBay calls here
 *
 * Scoring happens separately via /api/score (runs every 4 hours)
 * This keeps the cron fast and immune to eBay rate limits.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { scrapeCraigslist } from '@/lib/scrapers/craigslist'
import { Listing } from '@/types'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('🔍 Deal Scout cron starting (scrape phase)...')
  const results = { scraped: 0, saved: 0, skipped: 0, errors: [] as string[] }

  try {
    const allListings: Listing[] = []

    // Craigslist
    try {
      const clListings = await scrapeCraigslist()
      allListings.push(...clListings)
      console.log(`Craigslist: ${clListings.length} listings`)
    } catch (e: any) { results.errors.push(`Craigslist: ${e.message}`) }

    results.scraped = allListings.length
    console.log(`Total scraped: ${allListings.length}`)

    // Save new listings — no eBay calls, scores default to 0
    for (const listing of allListings) {
      try {
        // Dedup check
        const { data: existing } = await supabaseAdmin
          .from('scored_deals').select('id')
          .eq('platform', listing.platform)
          .eq('external_id', listing.external_id)
          .single()

        if (existing) { results.skipped++; continue }

        // Save with zeroed scores — /api/score will fill these in
        const { error: insertError } = await supabaseAdmin.from('scored_deals').insert({
          platform: listing.platform,
          external_id: listing.external_id,
          title: listing.title,
          asking_price: listing.asking_price,
          make: listing.make,
          model: listing.model,
          hours: listing.hours,
          location_city: listing.location_city,
          location_state: listing.location_state,
          distance_miles: listing.distance_miles,
          url: listing.url,
          image_urls: listing.image_urls,
          posted_at: listing.posted_at,
          // Scores zeroed out — will be filled by /api/score
          estimated_market_value: 0,
          profit_potential: 0,
          profit_percent: 0,
          deal_score: 0,
          comp_count: 0,
          qualifies: false,
          status: 'new',
          alert_sent: false,
        })

        if (insertError) {
          results.errors.push(`DB insert ${listing.external_id}: ${insertError.message}`)
          continue
        }

        results.saved++
      } catch (e: any) {
        results.errors.push(`Save ${listing.external_id}: ${e.message}`)
      }
    }
  } catch (e: any) {
    results.errors.push(`Fatal: ${e.message}`)
  }

  console.log('✅ Scrape phase complete:', results)
  return NextResponse.json(results)
}

export async function GET(req: NextRequest) { return POST(req) }
