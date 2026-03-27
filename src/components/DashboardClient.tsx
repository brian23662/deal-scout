'use client'

import { useState } from 'react'

type Deal = {
  id: string
  platform: string
  title: string
  asking_price: number
  estimated_market_value: number
  profit_potential: number
  profit_percent: number
  deal_score: number
  comp_count: number
  qualifies: boolean
  status: string
  location_city: string
  location_state: string
  distance_miles: number
  url: string
  image_urls: string[]
  make: string
  model: string
  hours: number
  created_at: string
  alert_sent: boolean
  notes: string
}

type Stats = {
  total: number
  qualified: number
  newToday: number
  purchased: number
}

const STATUS_COLORS: Record<string, string> = {
  new: '#22c55e',
  contacted: '#f59e0b',
  passed: '#6b7280',
  purchased: '#3b82f6',
}

const PLATFORM_LABELS: Record<string, string> = {
  craigslist: 'CL',
  facebook: 'FB',
  ebay: 'eBay',
  offerup: 'OU',
}

export default function DashboardClient({ deals, stats }: { deals: Deal[], stats: Stats }) {
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterPlatform, setFilterPlatform] = useState<string>('all')
  const [filterQualified, setFilterQualified] = useState<boolean>(false)
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)

  const filtered = deals.filter(d => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false
    if (filterPlatform !== 'all' && d.platform !== filterPlatform) return false
    if (filterQualified && !d.qualifies) return false
    return true
  })

  async function updateStatus(dealId: string, status: string) {
    await fetch(`/api/listings/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    window.location.reload()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#e5e5e5', fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid #1a1a1a', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '4px', color: '#444', marginBottom: 2 }}>ORMOND BEACH · FL</div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#fff' }}>DEAL SCOUT</div>
        </div>
        <div style={{ fontSize: 11, color: '#444', letterSpacing: '1px' }}>240mi · $600 MIN · 20% MARGIN</div>
      </header>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #1a1a1a' }}>
        {[
          { label: 'TOTAL SCRAPED', value: stats.total },
          { label: 'QUALIFIED DEALS', value: stats.qualified, highlight: true },
          { label: 'NEW TODAY', value: stats.newToday },
          { label: 'PURCHASED', value: stats.purchased },
        ].map((stat, i) => (
          <div key={i} style={{ padding: '16px 24px', borderRight: i < 3 ? '1px solid #1a1a1a' : 'none' }}>
            <div style={{ fontSize: 9, letterSpacing: '3px', color: '#444', marginBottom: 6 }}>{stat.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: stat.highlight ? '#22c55e' : '#fff' }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <FilterChip label="ALL STATUS" active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
        {['new', 'contacted', 'passed', 'purchased'].map(s => (
          <FilterChip key={s} label={s.toUpperCase()} active={filterStatus === s} onClick={() => setFilterStatus(s)} color={STATUS_COLORS[s]} />
        ))}
        <div style={{ width: 1, height: 20, background: '#222', margin: '0 4px' }} />
        {['all', 'craigslist', 'facebook', 'ebay', 'offerup'].map(p => (
          <FilterChip key={p} label={p === 'all' ? 'ALL PLATFORMS' : p.toUpperCase()} active={filterPlatform === p} onClick={() => setFilterPlatform(p)} />
        ))}
        <div style={{ width: 1, height: 20, background: '#222', margin: '0 4px' }} />
        <FilterChip label="QUALIFIED ONLY" active={filterQualified} onClick={() => setFilterQualified(!filterQualified)} color="#22c55e" />
        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#444' }}>{filtered.length} results</div>
      </div>

      {/* Deal list */}
      <div style={{ padding: '0 24px 24px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#333', fontSize: 13, letterSpacing: '2px' }}>
            NO DEALS MATCH YOUR FILTERS
          </div>
        ) : (
          filtered.map(deal => (
            <DealRow key={deal.id} deal={deal} onStatusChange={updateStatus} onClick={() => setSelectedDeal(deal)} />
          ))
        )}
      </div>

      {/* Detail panel */}
      {selectedDeal && (
        <DealDetailPanel deal={selectedDeal} onClose={() => setSelectedDeal(null)} onStatusChange={updateStatus} />
      )}
    </div>
  )
}

function DealRow({ deal, onStatusChange, onClick }: {
  deal: Deal
  onStatusChange: (id: string, status: string) => void
  onClick: () => void
}) {
  const scoreColor = deal.deal_score >= 80 ? '#22c55e' : deal.deal_score >= 60 ? '#f59e0b' : '#3b82f6'

  return (
    <div
      onClick={onClick}
      style={{ borderBottom: '1px solid #111', padding: '16px 0', display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 16, cursor: 'pointer', transition: 'background 0.1s' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#0f0f0f')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Score */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor, lineHeight: 1 }}>{deal.deal_score || '—'}</div>
        <div style={{ fontSize: 8, color: '#444', letterSpacing: '1px', marginTop: 2 }}>SCORE</div>
      </div>

      {/* Info */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          {deal.qualifies && (
            <span style={{ fontSize: 9, background: '#22c55e20', color: '#22c55e', padding: '2px 6px', borderRadius: 2, letterSpacing: '1px' }}>QUALIFIED</span>
          )}
          <span style={{ fontSize: 9, background: '#ffffff10', color: '#666', padding: '2px 6px', borderRadius: 2, letterSpacing: '1px' }}>
            {PLATFORM_LABELS[deal.platform] || deal.platform}
          </span>
          <span style={{ fontSize: 9, color: STATUS_COLORS[deal.status] || '#666', letterSpacing: '1px' }}>
            ● {deal.status?.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 14, color: '#e5e5e5', marginBottom: 6, fontWeight: 500 }}>{deal.title}</div>
        <div style={{ fontSize: 11, color: '#555', display: 'flex', gap: 16 }}>
          <span>{deal.location_city}, {deal.location_state}</span>
          {deal.distance_miles && <span>{deal.distance_miles} mi</span>}
          {deal.hours && <span>{deal.hours} hrs</span>}
          {deal.comp_count && <span>{deal.comp_count} comps</span>}
          <span>{new Date(deal.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Price */}
      <div style={{ textAlign: 'right', minWidth: 160 }}>
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: '#555' }}>asking </span>
          <span style={{ fontSize: 16, color: '#fff', fontWeight: 600 }}>${deal.asking_price?.toLocaleString()}</span>
        </div>
        {deal.estimated_market_value ? (
          <>
            <div style={{ marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: '#555' }}>market </span>
              <span style={{ fontSize: 13, color: '#888' }}>${deal.estimated_market_value?.toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#22c55e' }}>
              +${deal.profit_potential?.toLocaleString()}
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 400 }}> ({deal.profit_percent}%)</span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: '#333' }}>no comps</div>
        )}
      </div>
    </div>
  )
}

function DealDetailPanel({ deal, onClose, onStatusChange }: {
  deal: Deal
  onClose: () => void
  onStatusChange: (id: string, status: string) => void
}) {
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, background: '#0c0c0c', borderLeft: '1px solid #1a1a1a', overflowY: 'auto', zIndex: 100, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: '3px', color: '#444' }}>DEAL DETAIL</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      <h2 style={{ fontSize: 16, color: '#fff', margin: '0 0 4px', lineHeight: 1.4 }}>{deal.title}</h2>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 24 }}>
        {deal.location_city}, {deal.location_state} · {deal.distance_miles} miles
      </div>

      {/* Price breakdown */}
      <div style={{ background: '#111', borderRadius: 4, padding: 16, marginBottom: 16 }}>
        <DetailRow label="Asking Price" value={`$${deal.asking_price?.toLocaleString()}`} large />
        <DetailRow label="Est. Market Value" value={`$${deal.estimated_market_value?.toLocaleString()}`} />
        <DetailRow label="Profit Potential" value={`+$${deal.profit_potential?.toLocaleString()} (${deal.profit_percent}%)`} green />
        <DetailRow label="Deal Score" value={`${deal.deal_score}/100`} />
        <DetailRow label="eBay Comps" value={`${deal.comp_count} sold listings`} />
      </div>

      {/* Status buttons */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: '2px', color: '#444', marginBottom: 10 }}>UPDATE STATUS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {['new', 'contacted', 'passed', 'purchased'].map(s => (
            <button
              key={s}
              onClick={() => onStatusChange(deal.id, s)}
              style={{
                padding: '10px',
                background: deal.status === s ? STATUS_COLORS[s] + '30' : '#111',
                border: `1px solid ${deal.status === s ? STATUS_COLORS[s] : '#222'}`,
                color: deal.status === s ? STATUS_COLORS[s] : '#666',
                borderRadius: 4, cursor: 'pointer', fontSize: 10,
                letterSpacing: '2px', fontFamily: 'inherit',
              }}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <a
        href={deal.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', background: '#fff', color: '#000', textAlign: 'center', padding: 14, borderRadius: 4, textDecoration: 'none', fontWeight: 700, letterSpacing: '2px', fontSize: 12, fontFamily: 'inherit' }}
      >
        VIEW LISTING →
      </a>
    </div>
  )
}

function FilterChip({ label, active, onClick, color }: { label: string, active: boolean, onClick: () => void, color?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 10px',
        background: active ? (color ? color + '20' : '#ffffff15') : 'transparent',
        border: `1px solid ${active ? (color || '#fff') : '#222'}`,
        color: active ? (color || '#fff') : '#555',
        borderRadius: 3, cursor: 'pointer', fontSize: 9,
        letterSpacing: '2px', fontFamily: 'inherit', transition: 'all 0.1s',
      }}
    >
      {label}
    </button>
  )
}

function DetailRow({ label, value, large, green }: { label: string, value: string, large?: boolean, green?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1a1a1a' }}>
      <span style={{ fontSize: 11, color: '#555' }}>{label}</span>
      <span style={{ fontSize: large ? 18 : 14, fontWeight: large ? 700 : 400, color: green ? '#22c55e' : '#fff' }}>{value}</span>
    </div>
  )
}
