'use client'

import { useState } from 'react'
import { QuickComp, QuickCompSoldItem, ExtractionMethod } from '@/types'

type ApiSuccess = { ok: true; row: QuickComp; ebayError?: string }
type ApiNeedsManual = {
  ok: false
  needsManualEntry: true
  isKnownSpa?: boolean
  extracted: {
    source_url: string
    source_domain: string
    title?: string
    asking_price?: number
    extraction_method: ExtractionMethod
  }
}
type ApiError = { error: string; details?: string }
type ApiResponse = ApiSuccess | ApiNeedsManual | ApiError

function isSuccess(r: ApiResponse): r is ApiSuccess { return 'ok' in r && r.ok === true }
function isManualNeeded(r: ApiResponse): r is ApiNeedsManual { return 'ok' in r && r.ok === false }

export default function QuickCompClient({ history }: { history: QuickComp[] }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ApiResponse | null>(null)
  const [manualTitle, setManualTitle] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [selected, setSelected] = useState<QuickComp | null>(null)

  async function runLookup(payload: { url: string; title?: string; asking_price?: number }) {
    setLoading(true)
    try {
      const res = await fetch('/api/quick-comp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data: ApiResponse = await res.json()
      setResult(data)

      // Prefill manual form if extraction got partial data
      if (isManualNeeded(data)) {
        setManualTitle(data.extracted.title || '')
        setManualPrice(
          data.extracted.asking_price !== undefined ? String(data.extracted.asking_price) : ''
        )
      }

      // Reload page to refresh history if we saved a row
      if (isSuccess(data)) setTimeout(() => window.location.reload(), 400)
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'Request failed' })
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit() {
    if (!url.trim()) return
    setResult(null)
    runLookup({ url: url.trim() })
  }

  function handleManualSubmit() {
    if (!manualTitle.trim() || !manualPrice) return
    const priceNum = parseFloat(manualPrice)
    if (Number.isNaN(priceNum) || priceNum <= 0) return
    runLookup({ url: url.trim(), title: manualTitle.trim(), asking_price: priceNum })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#e5e5e5', fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid #1a1a1a', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '4px', color: '#444', marginBottom: 2 }}>DEAL SCOUT</div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#fff' }}>QUICK COMP</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <a href="/" style={{ fontSize: 10, letterSpacing: '2px', color: '#666', textDecoration: 'none' }}>← HOME</a>
          <a href="/dashboard" style={{ fontSize: 10, letterSpacing: '2px', color: '#666', textDecoration: 'none' }}>DASHBOARD →</a>
        </div>
      </header>

      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>

        {/* URL input */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 10, letterSpacing: '2px', color: '#666', display: 'block', marginBottom: 8 }}>
            PASTE LISTING URL
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && handleSubmit()}
              placeholder="https://..."
              disabled={loading}
              style={{
                flex: 1, background: '#111', border: '1px solid #222', color: '#e5e5e5',
                padding: '12px 14px', borderRadius: 4, fontSize: 13, fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={loading || !url.trim()}
              style={{
                padding: '12px 20px', background: loading ? '#222' : '#fff',
                color: loading ? '#666' : '#000', border: 'none', borderRadius: 4,
                fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: '2px',
                cursor: loading || !url.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'LOOKING UP...' : 'LOOK UP COMPS'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 6, letterSpacing: '1px' }}>
            AUTO-EXTRACTS FROM CRAIGSLIST AND EBAY · MANUAL ENTRY FOR GOVDEALS, HIBID, FACEBOOK
          </div>
        </div>

        {/* Result */}
        {result && 'error' in result && (
          <div style={{ background: '#2a0f0f', border: '1px solid #5a1f1f', padding: 16, borderRadius: 4, marginBottom: 24, fontSize: 12, color: '#ff8888' }}>
            ERROR: {result.error}{result.details ? ` — ${result.details}` : ''}
          </div>
        )}

        {result && isManualNeeded(result) && (
          <ManualEntryPanel
            isKnownSpa={!!result.isKnownSpa}
            domain={result.extracted.source_domain}
            method={result.extracted.extraction_method}
            title={manualTitle}
            price={manualPrice}
            onTitleChange={setManualTitle}
            onPriceChange={setManualPrice}
            onSubmit={handleManualSubmit}
            loading={loading}
          />
        )}

        {result && isSuccess(result) && (
          <QuickCompResult row={result.row} ebayError={result.ebayError} />
        )}

        {/* History */}
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 10, letterSpacing: '3px', color: '#444', marginBottom: 12 }}>
            HISTORY — LAST {history.length}
          </div>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#333', fontSize: 12, letterSpacing: '2px' }}>
              NO LOOKUPS YET
            </div>
          ) : (
            <div style={{ background: '#0c0c0c', border: '1px solid #1a1a1a', borderRadius: 4 }}>
              {history.map((row, i) => (
                <HistoryRow
                  key={row.id}
                  row={row}
                  first={i === 0}
                  last={i === history.length - 1}
                  onClick={() => setSelected(row)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <QuickCompDetailPanel row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

// ---------- Subcomponents ----------

function ManualEntryPanel({
  isKnownSpa, domain, method, title, price, onTitleChange, onPriceChange, onSubmit, loading,
}: {
  isKnownSpa: boolean
  domain: string
  method: ExtractionMethod
  title: string
  price: string
  onTitleChange: (v: string) => void
  onPriceChange: (v: string) => void
  onSubmit: () => void
  loading: boolean
}) {
  const heading = isKnownSpa ? 'MANUAL ENTRY' : 'AUTO-EXTRACT INCOMPLETE — FILL IN MANUALLY'
  const subline = isKnownSpa
    ? `${domain} requires manual entry — their pages are built after load, so we can't read them server-side. Type the title and price and we'll run the comps.`
    : `Source: ${domain} · Method: ${method}`
  const headingColor = isKnownSpa ? '#60a5fa' : '#f59e0b'

  return (
    <div style={{ background: '#111', border: '1px solid #222', padding: 16, borderRadius: 4, marginBottom: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: '2px', color: headingColor, marginBottom: 12 }}>
        {heading}
      </div>
      <div style={{ fontSize: 11, color: '#777', marginBottom: 16, lineHeight: 1.5 }}>
        {subline}
      </div>

      <label style={{ fontSize: 10, letterSpacing: '2px', color: '#666', display: 'block', marginBottom: 6 }}>
        TITLE
      </label>
      <input
        value={title}
        onChange={e => onTitleChange(e.target.value)}
        placeholder="e.g. 2019 Toro TimeCutter SS5000 50 inch"
        style={{
          width: '100%', background: '#0c0c0c', border: '1px solid #222', color: '#e5e5e5',
          padding: '10px 12px', borderRadius: 4, fontSize: 13, fontFamily: 'inherit',
          outline: 'none', marginBottom: 12, boxSizing: 'border-box',
        }}
      />

      <label style={{ fontSize: 10, letterSpacing: '2px', color: '#666', display: 'block', marginBottom: 6 }}>
        ASKING PRICE (USD)
      </label>
      <input
        type="number"
        value={price}
        onChange={e => onPriceChange(e.target.value)}
        placeholder="e.g. 2800"
        style={{
          width: '100%', background: '#0c0c0c', border: '1px solid #222', color: '#e5e5e5',
          padding: '10px 12px', borderRadius: 4, fontSize: 13, fontFamily: 'inherit',
          outline: 'none', marginBottom: 16, boxSizing: 'border-box',
        }}
      />

      <button
        onClick={onSubmit}
        disabled={loading || !title.trim() || !price}
        style={{
          padding: '10px 20px', background: loading ? '#222' : '#fff',
          color: loading ? '#666' : '#000', border: 'none', borderRadius: 4,
          fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: '2px',
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'RUNNING...' : 'RUN COMPS'}
      </button>
    </div>
  )
}

function QuickCompResult({ row, ebayError }: { row: QuickComp; ebayError?: string }) {
  const profitColor = (row.estimated_profit || 0) > 0 ? '#22c55e' : '#ef4444'

  return (
    <div style={{ background: '#111', border: '1px solid #222', padding: 20, borderRadius: 4, marginBottom: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: '2px', color: '#22c55e', marginBottom: 8 }}>
        ✓ LOOKUP SAVED · {row.extraction_method?.toUpperCase()}
      </div>
      <h2 style={{ fontSize: 16, color: '#fff', margin: '0 0 16px', lineHeight: 1.4 }}>{row.title}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Metric label="Asking" value={fmt(row.asking_price)} />
        <Metric label="Median Comp" value={fmt(row.median_price)} />
        <Metric label="Relevant Comps" value={String(row.comp_count ?? 0)} />
        <Metric label="Est. Profit (after fees)" value={fmt(row.estimated_profit)} color={profitColor} />
      </div>

      {ebayError && (
        <div style={{ background: '#2a1a0f', border: '1px solid #5a3a1f', padding: 10, borderRadius: 4, marginBottom: 16, fontSize: 11, color: '#fbbf24' }}>
          eBay warning: {ebayError}
        </div>
      )}

      {row.comps && row.comps.length > 0 && (
        <CompsTable comps={row.comps} median={row.median_price || 0} />
      )}
    </div>
  )
}

function CompsTable({ comps, median }: { comps: QuickCompSoldItem[]; median: number }) {
  const sorted = [...comps].sort((a, b) => b.price - a.price)
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '2px', color: '#444', marginBottom: 10 }}>EBAY SOLD COMPS</div>
      <div style={{ background: '#0c0c0c', borderRadius: 4, overflow: 'hidden' }}>
        {sorted.map((c, i) => {
          const isMedian = median > 0 && c.price === median
          return (
            <a
              key={i}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderBottom: i < sorted.length - 1 ? '1px solid #1a1a1a' : 'none',
                background: isMedian ? '#22c55e08' : 'transparent',
                textDecoration: 'none',
              }}
            >
              <span style={{ fontSize: 11, color: '#777', flex: 1, marginRight: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isMedian && <span style={{ color: '#22c55e', marginRight: 6 }}>▶</span>}
                {c.title}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: isMedian ? '#22c55e' : '#ccc', whiteSpace: 'nowrap' }}>
                ${c.price.toLocaleString()}
              </span>
            </a>
          )
        })}
      </div>
      {median > 0 && (
        <div style={{ fontSize: 10, color: '#333', marginTop: 6, letterSpacing: '1px' }}>
          ▶ = MEDIAN (used as market value)
        </div>
      )}
    </div>
  )
}

function HistoryRow({ row, first, last, onClick }: {
  row: QuickComp; first: boolean; last: boolean; onClick: () => void
}) {
  const profit = row.estimated_profit
  const profitColor = profit === null || profit === undefined ? '#555' : profit > 0 ? '#22c55e' : '#ef4444'
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 16px',
        borderBottom: last ? 'none' : '1px solid #1a1a1a',
        borderTopLeftRadius: first ? 4 : 0, borderTopRightRadius: first ? 4 : 0,
        display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16,
        cursor: 'pointer', alignItems: 'center',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = '#0f0f0f')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#e5e5e5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
          {row.title || '(no title extracted)'}
        </div>
        <div style={{ fontSize: 10, color: '#555', letterSpacing: '1px' }}>
          {row.source_domain} · {row.extraction_method} · {row.created_at ? new Date(row.created_at).toLocaleDateString() : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 90 }}>
        <div style={{ fontSize: 9, color: '#444', letterSpacing: '1px' }}>ASK</div>
        <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{fmt(row.asking_price)}</div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 100 }}>
        <div style={{ fontSize: 9, color: '#444', letterSpacing: '1px' }}>EST. PROFIT</div>
        <div style={{ fontSize: 13, color: profitColor, fontWeight: 700 }}>
          {profit !== null && profit !== undefined ? (profit > 0 ? '+' : '') + fmt(profit) : '—'}
        </div>
      </div>
    </div>
  )
}

function QuickCompDetailPanel({ row, onClose }: { row: QuickComp; onClose: () => void }) {
  const comps = Array.isArray(row.comps) ? row.comps : []
  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, background: '#0c0c0c', borderLeft: '1px solid #1a1a1a', overflowY: 'auto', zIndex: 100, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: '3px', color: '#444' }}>LOOKUP DETAIL</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      <h2 style={{ fontSize: 16, color: '#fff', margin: '0 0 4px', lineHeight: 1.4 }}>
        {row.title || '(no title)'}
      </h2>
      <div style={{ fontSize: 11, color: '#555', marginBottom: 24, letterSpacing: '1px' }}>
        {row.source_domain} · {row.extraction_method?.toUpperCase()} · {row.created_at ? new Date(row.created_at).toLocaleString() : ''}
      </div>

      <div style={{ background: '#111', borderRadius: 4, padding: 16, marginBottom: 16 }}>
        <DetailRow label="Asking Price" value={fmt(row.asking_price)} large />
        <DetailRow label="Median Comp" value={fmt(row.median_price)} />
        <DetailRow
          label="Est. Profit (after fees)"
          value={(row.estimated_profit ?? 0) > 0 ? '+' + fmt(row.estimated_profit) : fmt(row.estimated_profit)}
          green={(row.estimated_profit ?? 0) > 0}
        />
        <DetailRow label="Relevant Comps" value={String(row.comp_count ?? 0)} />
        <DetailRow label="eBay Query" value={row.ebay_query || '—'} />
      </div>

      {comps.length > 0 ? (
        <CompsTable comps={comps} median={row.median_price || 0} />
      ) : (
        <div style={{ background: '#111', borderRadius: 4, padding: 16, marginBottom: 16, fontSize: 12, color: '#444', textAlign: 'center', letterSpacing: '1px' }}>
          NO COMPS FOUND
        </div>
      )}

      <a
        href={row.source_url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'block', marginTop: 24, background: '#fff', color: '#000', textAlign: 'center', padding: 14, borderRadius: 4, textDecoration: 'none', fontWeight: 700, letterSpacing: '2px', fontSize: 12, fontFamily: 'inherit' }}
      >
        VIEW LISTING →
      </a>
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#444', letterSpacing: '2px', marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 20, color: color || '#fff', fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function DetailRow({ label, value, large, green }: { label: string; value: string; large?: boolean; green?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #1a1a1a' }}>
      <span style={{ fontSize: 11, color: '#555' }}>{label}</span>
      <span style={{ fontSize: large ? 18 : 13, fontWeight: large ? 700 : 500, color: green ? '#22c55e' : '#fff' }}>
        {value}
      </span>
    </div>
  )
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return '$' + Math.round(n).toLocaleString()
}
