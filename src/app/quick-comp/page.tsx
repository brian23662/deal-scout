import { supabaseAdmin } from '@/lib/supabase'
import QuickCompClient from '@/components/QuickCompClient'
import { QuickComp } from '@/types'

export const revalidate = 0 // always fresh

export default async function QuickCompPage() {
  const { data: history } = await supabaseAdmin
    .from('quick_comps')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return <QuickCompClient history={(history || []) as QuickComp[]} />
}
