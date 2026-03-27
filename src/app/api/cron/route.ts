/**
 * POST /api/cron - Main orchestration, runs every 30 min via Vercel Cron
 * Secured with x-cron-secret header
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchSoldComps } from '@/lib/ebay/client'
import { scoreDeal } from '@/lib/scoring'
import { sendDealAlerts } from '@/lib/alerts'
import { supabaseAdmin } from '@/lib/supabase'
import { scrapeCraigslist } from '@/lib/scrapers/craigslist'
import { Listing } from '@/types'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('🔍 Deal Scout cron starting...')
  const results = { scraped: 0, scored: 0, qualified: 0, alerted: 0, errors: [] as string[] }

  try {
    const allListings: Listing[] = []

    // Craigslist (always on)
    try {
      const clListings = await scrapeCraigslist()
      allListings.push(...clListings)
      console.log(`Craigslist: ${clListings.length} listings`)
    } catch (e: any) { results.errors.push(`Craigslist: ${e.message}`) }

    // Facebook via Apify (when token present)
    if (process.env.APIFY_API_TOKEN) {
      try {
        const { scrapeMarketplace } = await import('@/lib/scrapers/facebook')
        const fbListings = await scrapeMarketplace()
        allListings.push(...fbListings)
        console.log(`Facebook: ${fbListings.length} listings`)
      } catch (e: any) { results.errors.push(`Facebook: ${e.message}`) }
    }

    results.scraped = allListings.length

    for (const listing of allListings) {
      try {
        // Dedup check
        const { data: existing } = await supabaseAdmin
          .from('scored_deals').select('id')
          .eq('platform', listing.platform).eq('external_id', listing.external_id).single()
        if (existing) continue

        // Score against eBay comps
        const comps = await fetchSoldComps(listing.make || 'zero turn mower', listing.model, 20)
        const score = scoreDeal(listing, comps)
        results.scored++

        // Save to DB
        const { error: insertError } = await supabaseAdmin.from('scored_deals').insert({
          platform: listing.platform, external_id: listing.external_id, title: listing.title,
          asking_price: listing.asking_price, make: listing.make, model: listing.model,
          hours: listing.hours, location_city: listing.location_city,
          location_state: listing.location_state, distance_miles: listing.distance_miles,
          url: listing.url, image_urls: listing.image_urls, posted_at: listing.posted_at,
          estimated_market_value: score.estimated_market_value,
          profit_potential: score.profit_potential, profit_percent: score.profit_percent,
          deal_score: score.score, comp_count: score.comp_count,
          qualifies: score.qualifies, status: 'new', alert_sent: false,
        })

        if (insertError) { results.errors.push(`DB: ${insertError.message}`); continue }

        // Alert if qualifies
        if (score.qualifies) {
          results.qualified++
          await sendDealAlerts(listing, score)
          await supabaseAdmin.from('scored_deals').update({ alert_sent: true })
            .eq('platform', listing.platform).eq('external_id', listing.external_id)
          results.alerted++
          console.log(`🔥 Alert: ${listing.title} - $${score.profit_potential} profit`)
        }

        await new Promise(r => setTimeout(r, 500))
      } catch (e: any) { results.errors.push(`Scoring ${listing.external_id}: ${e.message}`) }
    }
  } catch (e: any) { results.errors.push(`Fatal: ${e.message}`) }

  console.log('✅ Cron complete:', results)
  return NextResponse.json(results)
}

export async function GET(req: NextRequest) { return POST(req) }
