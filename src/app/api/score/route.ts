/**
 * POST /api/score - Score unscored listings against eBay comps
 * Triggered every 4 hours via cron-job.org (separate job from /api/cron)
 * Secured with x-cron-secret header
 *
 * Phase 2 of 2-phase approach:
 * 1. Fetch up to BATCH_SIZE listings where comp_count = 0
 * 2. For each, call eBay Finding API with a delay between calls
 * 3. Update scores in Supabase
 * 4. Send alerts for qualifying deals
 * 5. If eBay rate limits, stop gracefully — next run will continue
 *
 * At 2s delay between calls and batch size of 10:
 * - One run = ~10 eBay calls over ~20 seconds
 * - 6 runs/day = ~60 calls/day — well within free tier limits
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchSoldComps } from '@/lib/ebay/client'
import { scoreDeal } from '@/lib/scoring'
import { sendDealAlerts } from '@/lib/alerts'
import { supabaseAdmin } from '@/lib/supabase'

const BATCH_SIZE = 10
const DELAY_MS = 2000 // 2 seconds between eBay calls

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('📊 Deal Scout score phase starting...')
  const results = { processed: 0, scored: 0, qualified: 0, alerted: 0, rateLimited: false, errors: [] as string[] }

  // Fetch unscored listings (comp_count = 0), oldest first
  const { data: unscored, error: fetchError } = await supabaseAdmin
    .from('scored_deals')
    .select('*')
    .eq('comp_count', 0)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!unscored || unscored.length === 0) {
    console.log('✅ No unscored listings — nothing to do')
    return NextResponse.json({ message: 'No unscored listings', ...results })
  }

  console.log(`Found ${unscored.length} unscored listings to process`)

  for (const deal of unscored) {
    try {
      results.processed++

      // Fetch eBay comps
      const comps = await fetchSoldComps(deal.make, deal.model, 20, deal.title)
      const listing = {
        platform: deal.platform,
        external_id: deal.external_id,
        title: deal.title,
        asking_price: deal.asking_price,
        make: deal.make,
        model: deal.model,
        hours: deal.hours,
        location_city: deal.location_city,
        location_state: deal.location_state,
        distance_miles: deal.distance_miles,
        url: deal.url,
        image_urls: deal.image_urls,
        posted_at: deal.posted_at,
        scraped_at: deal.created_at,
      }

      const score = scoreDeal(listing, comps)
      results.scored++

      // Update scores in DB
      const { error: updateError } = await supabaseAdmin
        .from('scored_deals')
        .update({
          estimated_market_value: score.estimated_market_value,
          profit_potential: score.profit_potential,
          profit_percent: score.profit_percent,
          deal_score: score.score,
          comp_count: score.comp_count,
          qualifies: score.qualifies,
        })
        .eq('id', deal.id)

      if (updateError) {
        results.errors.push(`DB update ${deal.external_id}: ${updateError.message}`)
        continue
      }

      // Send alert if qualifies and not already alerted
      if (score.qualifies && !deal.alert_sent) {
        results.qualified++
        await sendDealAlerts(listing, score)
        await supabaseAdmin
          .from('scored_deals')
          .update({ alert_sent: true })
          .eq('id', deal.id)
        results.alerted++
        console.log(`🔥 Alert: ${deal.title} — $${score.profit_potential} profit`)
      }

      // Polite delay between eBay calls
      await new Promise(r => setTimeout(r, DELAY_MS))

    } catch (e: any) {
      // If eBay rate limits us, stop immediately and report
      // The next run will pick up where we left off
      if (e.message?.includes('10001') || e.message?.toLowerCase().includes('rate limit')) {
        console.warn('⚠️ eBay rate limited — stopping early, will resume next run')
        results.rateLimited = true
        break
      }
      results.errors.push(`Score ${deal.external_id}: ${e.message}`)
    }
  }

  console.log('✅ Score phase complete:', results)
  return NextResponse.json(results)
}

export async function GET(req: NextRequest) { return POST(req) }
