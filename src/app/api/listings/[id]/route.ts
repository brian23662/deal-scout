import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const allowedFields = ['status', 'notes', 'actual_buy_price', 'actual_sell_price', 'actual_profit']
  const updates: Record<string, any> = {}

  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field]
  }

  if (updates.actual_buy_price && updates.actual_sell_price) {
    updates.actual_profit = updates.actual_sell_price - updates.actual_buy_price
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('scored_deals').update(updates).eq('id', params.id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deal: data })
}
