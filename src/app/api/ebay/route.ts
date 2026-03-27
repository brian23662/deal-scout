import { NextRequest, NextResponse } from 'next/server'
import { fetchSoldComps, calculateMarketValue } from '@/lib/ebay/client'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const make = searchParams.get('make')
  const model = searchParams.get('model') || undefined
  const limit = parseInt(searchParams.get('limit') || '20')

  if (!make) return NextResponse.json({ error: 'make parameter is required' }, { status: 400 })

  try {
    const comps = await fetchSoldComps(make, model, limit)
    const stats = calculateMarketValue(comps)
    return NextResponse.json({ make, model, comps, stats })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch comps' }, { status: 500 })
  }
}
