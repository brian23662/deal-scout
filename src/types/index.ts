export type Platform = 'craigslist' | 'facebook' | 'ebay' | 'offerup'
export type DealStatus = 'new' | 'contacted' | 'passed' | 'purchased'
export type Condition = 'excellent' | 'good' | 'fair' | 'poor'

export interface Listing {
  id?: string
  platform: Platform
  external_id: string
  title: string
  description?: string
  asking_price: number
  condition?: Condition
  make?: string
  model?: string
  hours?: number
  year?: number
  location_city: string
  location_state: string
  location_zip?: string
  distance_miles?: number
  url: string
  image_urls?: string[]
  posted_at?: string
  scraped_at: string
}

export interface EbayComp {
  id?: string
  ebay_item_id: string
  title: string
  make?: string
  model?: string
  hours?: number
  condition: string
  sold_price: number
  sold_date: string
  location?: string
  url: string
}

export interface DealScore {
  listing_id: string
  estimated_market_value: number
  comp_count: number
  profit_potential: number
  profit_percent: number
  score: number
  qualifies: boolean
  comps_used: EbayComp[]
}

export interface ScoredDeal {
  id?: string
  listing: Listing
  score: DealScore
  status: DealStatus
  alert_sent: boolean
  notes?: string
  actual_buy_price?: number
  actual_sell_price?: number
  actual_profit?: number
  created_at?: string
  updated_at?: string
}

export interface ScoringConfig {
  minProfitDollars: number
  minProfitPercent: number
  maxDistanceMiles: number
  homeZip: string
}

export interface EbayToken {
  access_token: string
  expires_in: number
  token_type: string
}
