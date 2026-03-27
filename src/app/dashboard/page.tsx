import { supabaseAdmin } from '@/lib/supabase'
import DashboardClient from '@/components/DashboardClient'

export const revalidate = 60

export default async function DashboardPage() {
  const { data: deals } = await supabaseAdmin
    .from('scored_deals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  const today = new Date().toDateString()
  const stats = {
    total: deals?.length || 0,
    qualified: deals?.filter(d => d.qualifies).length || 0,
    newToday: deals?.filter(d => new Date(d.created_at).toDateString() === today).length || 0,
    purchased: deals?.filter(d => d.status === 'purchased').length || 0,
  }

  return <DashboardClient deals={deals || []} stats={stats} />
}
