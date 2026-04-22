import Link from 'next/link'

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: '#e5e5e5', fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace' }}>
      <header style={{ borderBottom: '1px solid #1a1a1a', padding: '16px 24px' }}>
        <div style={{ fontSize: 10, letterSpacing: '4px', color: '#444', marginBottom: 2 }}>ORMOND BEACH · FL</div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#fff' }}>DEAL SCOUT</div>
      </header>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '48px 24px' }}>
        <div style={{ fontSize: 10, letterSpacing: '3px', color: '#666', marginBottom: 8 }}>CHOOSE A TOOL</div>
        <h1 style={{ fontSize: 24, color: '#fff', fontWeight: 700, margin: '0 0 32px', letterSpacing: '1px' }}>
          Find your next flip.
        </h1>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
          <LandingCard
            href="/quick-comp"
            eyebrow="MANUAL · ON-DEMAND"
            title="Quick Comp"
            body="Paste a listing URL from anywhere — Craigslist, eBay, GovDeals, HiBid, Facebook Marketplace, or elsewhere. Get an instant eBay sold-comp analysis with estimated profit after fees."
            bullets={[
              'Works on any site (manual entry fallback for SPAs)',
              'Uses live eBay sold comps',
              'Saves every lookup to a searchable history',
            ]}
            cta="LOOK UP A LISTING →"
          />

          <LandingCard
            href="/dashboard"
            eyebrow="AUTOMATED · PASSIVE"
            title="Deals Dashboard"
            body="Craigslist scraper runs on your Mac mini, scores thousands of listings against eBay comps, and surfaces qualified deals that match your thresholds ($600+ profit, 20%+ margin, within 240 miles)."
            bullets={[
              '8 FL markets × 5 categories',
              'Scored 0–100 on profit and confidence',
              'Filter by status, platform, qualified-only',
            ]}
            cta="VIEW DASHBOARD →"
          />
        </div>

        <div style={{ marginTop: 48, fontSize: 11, color: '#444', letterSpacing: '1px', textAlign: 'center' }}>
          240MI · $600 MIN · 20% MARGIN
        </div>
      </div>
    </div>
  )
}

function LandingCard({
  href, eyebrow, title, body, bullets, cta,
}: {
  href: string
  eyebrow: string
  title: string
  body: string
  bullets: string[]
  cta: string
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        background: '#0c0c0c',
        border: '1px solid #1a1a1a',
        borderRadius: 6,
        padding: 28,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.15s',
      }}
      // Inline hover via onMouseEnter/Leave to match the dashboard's pattern
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLElement).style.background = '#0f0f0f' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#1a1a1a'; (e.currentTarget as HTMLElement).style.background = '#0c0c0c' }}
    >
      <div style={{ fontSize: 9, letterSpacing: '3px', color: '#555', marginBottom: 10 }}>{eyebrow}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 14, letterSpacing: '1px' }}>{title}</div>
      <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6, marginBottom: 16 }}>{body}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px' }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ fontSize: 11, color: '#777', padding: '4px 0', lineHeight: 1.5 }}>
            <span style={{ color: '#22c55e', marginRight: 8 }}>▸</span>{b}
          </li>
        ))}
      </ul>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '2px' }}>{cta}</div>
    </Link>
  )
}
