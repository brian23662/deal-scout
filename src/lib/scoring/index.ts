import { Listing, EbayComp, DealScore, ScoringConfig } from '@/types'
import { calculateMarketValue } from '@/lib/ebay/client'

export const DEFAULT_CONFIG: ScoringConfig = {
  minProfitDollars: parseInt(process.env.MIN_PROFIT_DOLLARS || '600'),
  minProfitPercent: parseInt(process.env.MIN_PROFIT_PERCENT || '20'),
  maxDistanceMiles: parseInt(process.env.MAX_DISTANCE_MILES || '240'),
  homeZip: process.env.HOME_ZIP || '32174',
}

export function scoreDeal(listing: Listing, comps: EbayComp[], config: ScoringConfig = DEFAULT_CONFIG): DealScore {
  const { marketValue, sampleSize } = calculateMarketValue(comps)

  if (marketValue === 0 || sampleSize === 0) {
    return { listing_id: listing.external_id, estimated_market_value: 0, comp_count: 0, profit_potential: 0, profit_percent: 0, score: 0, qualifies: false, comps_used: [] }
  }

  const profitPotential = marketValue - listing.asking_price
  const profitPercent = (profitPotential / marketValue) * 100
  const meetsProfit = profitPotential >= config.minProfitDollars
  const meetsPercent = profitPercent >= config.minProfitPercent
  const withinRange = (listing.distance_miles || 0) <= config.maxDistanceMiles
  const qualifies = meetsProfit && meetsPercent && withinRange

  const percentScore = Math.min((profitPercent / 50) * 40, 40)
  const dollarScore = Math.min((profitPotential / 2000) * 40, 40)
  const confidenceScore = Math.min((sampleSize / 20) * 20, 20)
  const score = Math.round(percentScore + dollarScore + confidenceScore)

  return {
    listing_id: listing.external_id,
    estimated_market_value: marketValue,
    comp_count: sampleSize,
    profit_potential: Math.round(profitPotential),
    profit_percent: Math.round(profitPercent * 10) / 10,
    score,
    qualifies,
    comps_used: comps.slice(0, 5),
  }
}

export function formatDealAlert(listing: Listing, score: DealScore): string {
  const emoji = score.score >= 80 ? '🔥' : score.score >= 60 ? '⚡' : '💰'
  return `${emoji} DEAL ALERT - Deal Scout

${listing.title}
Platform: ${listing.platform.toUpperCase()}
Location: ${listing.location_city}, ${listing.location_state} (${listing.distance_miles} miles)

Asking Price:     $${listing.asking_price.toLocaleString()}
Market Value:     $${score.estimated_market_value.toLocaleString()}
Profit Potential: $${score.profit_potential.toLocaleString()} (${score.profit_percent}%)
Deal Score:       ${score.score}/100

${listing.url}

Based on ${score.comp_count} recent eBay sold listings.`.trim()
}

export function formatDealAlertHTML(listing: Listing, score: DealScore): string {
  const scoreColor = score.score >= 80 ? '#22c55e' : score.score >= 60 ? '#f59e0b' : '#3b82f6'
  return `<div style="font-family: monospace; max-width: 600px; margin: 0 auto; background: #0f0f0f; color: #e5e5e5; padding: 24px; border-radius: 8px;">
  <div style="font-size: 11px; letter-spacing: 3px; color: #666; margin-bottom: 4px;">DEAL SCOUT</div>
  <h2 style="color: #fff; margin: 0 0 4px;">${listing.title}</h2>
  <div style="font-size: 13px; color: #888; margin-bottom: 24px;">${listing.platform.toUpperCase()} - ${listing.location_city}, ${listing.location_state} - ${listing.distance_miles} miles away</div>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
    <tr><td style="padding: 8px 0; color: #888; font-size: 13px;">Asking Price</td><td style="padding: 8px 0; text-align: right; color: #fff; font-size: 18px; font-weight: bold;">$${listing.asking_price.toLocaleString()}</td></tr>
    <tr style="border-top: 1px solid #222;"><td style="padding: 8px 0; color: #888; font-size: 13px;">Est. Market Value</td><td style="padding: 8px 0; text-align: right; color: #fff; font-size: 18px;">$${score.estimated_market_value.toLocaleString()}</td></tr>
    <tr style="border-top: 1px solid #222;"><td style="padding: 8px 0; color: #888; font-size: 13px;">Profit Potential</td><td style="padding: 8px 0; text-align: right; color: #22c55e; font-size: 22px; font-weight: bold;">+$${score.profit_potential.toLocaleString()} (${score.profit_percent}%)</td></tr>
  </table>
  <div style="margin-bottom: 24px;"><span style="font-size: 11px; letter-spacing: 2px; color: #666;">DEAL SCORE </span><span style="font-size: 28px; font-weight: bold; color: ${scoreColor};">${score.score}/100</span> <span style="font-size: 11px; color: #555;">based on ${score.comp_count} sold comps</span></div>
  <a href="${listing.url}" style="display: block; background: #fff; color: #000; text-align: center; padding: 14px; border-radius: 4px; text-decoration: none; font-weight: bold; letter-spacing: 1px; font-size: 13px;">VIEW LISTING</a>
</div>`.trim()
}
