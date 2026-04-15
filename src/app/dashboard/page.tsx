import { supabaseAdmin } from '@/lib/supabase'
import DashboardClient from '@/components/DashboardClient'

export const revalidate = 60

export default async function DashboardPage() {
  // Only fetch qualified deals, best score first
  const { data: deals } = await supabaseAdmin
    .from('scored_deals')
    .select('*')
    .eq('qualifies', true)
    .order('deal_score', { ascending: false })

  // Accurate counts pulled separately so stats reflect the full table
  const { count: totalCount } = await supabaseAdmin
    .from('scored_deals')
    .select('*', { count: 'exact', head: true })

  const { count: qualifiedCount } = await supabaseAdmin
    .from('scored_deals')
    .select('*', { count: 'exact', head: true })
    .eq('qualifies', true)

  const today = new Date().toDateString()
  const { count: newTodayCount } = await supabaseAdmin
    .from('scored_deals')
    .select('*', { count: 'exact', head: true })
    .eq('qualifies', true)
    .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())

  const { count: purchasedCount } = await supabaseAdmin
    .from('scored_deals')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'purchased')

  const stats = {
    total: totalCount || 0,
    qualified: qualifiedCount || 0,
    newToday: newTodayCount || 0,
    purchased: purchasedCount || 0,
  }

  return <DashboardClient deals={deals || []} stats={stats} />
}
