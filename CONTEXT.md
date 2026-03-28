# Deal Scout — Project Context & Continuation Prompt

Use this file to onboard a new Claude conversation with full context on this project.
Paste the contents of this file at the start of a new chat session.

---

## CONTINUATION PROMPT

I'm continuing work on a project called **Deal Scout** — an automated deal-finding tool for
riding mowers and outdoor power equipment. Here's everything you need to know to pick up
where we left off.

---

### What Deal Scout Does

Deal Scout monitors online marketplaces for undervalued zero-turn mowers, riding mowers,
and related equipment, scores each listing against real eBay sold data to estimate profit
potential, and sends SMS + email alerts when a deal meets our thresholds. A Next.js
dashboard tracks deal status from discovery through purchase.

**Core loop (runs every 30 min via Vercel Cron):**
1. Scrape Craigslist (8 FL markets) and Facebook Marketplace (via Apify) for listings
2. Fetch eBay sold comps for each listing's make/model via the eBay Finding API
3. Score each listing — flag if profit potential >= 20% margin AND >= $600 absolute profit
4. Save all scored deals to Supabase
5. Send SMS (Twilio) + email (Resend) alerts for qualifying deals
6. Dashboard at /dashboard shows all deals with filter/sort and status workflow

---

### Deal Parameters

| Parameter | Value |
|-----------|-------|
| Home base | Ormond Beach, FL (zip 32174) |
| Search radius | 240 miles |
| Min profit (absolute) | $600 |
| Min profit (percent) | 20% |
| Alert channels | SMS via Twilio, Email via Resend |
| Target category | Zero-turn and riding mowers (phase 1) |
| Min listing price | $500 (filters out push mowers / junk) |

All thresholds live in `.env.local` — no code changes needed to adjust them.

---

### Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Database:** Supabase (3 tables: scored_deals, ebay_comps, alert_log)
- **Deployment:** Vercel (Hobby plan — cron requires Pro or external trigger)
- **Scraping:** Cheerio for Craigslist, Apify actor for Facebook Marketplace
- **Pricing data:** eBay Finding API (findCompletedItems — sold listings only)
- **Alerts:** Twilio SMS + Resend email
- **Language:** TypeScript throughout

**GitHub repo:** https://github.com/brian23662/deal-scout

---

### File Structure

```
deal-scout/
├── .env.example                        ← All required env vars documented here
├── scripts/
│   └── test-ebay.ts                    ← Run this to verify eBay API works
├── supabase/migrations/
│   └── 001_initial_schema.sql          ← Run in Supabase SQL Editor to create tables
└── src/
    ├── types/index.ts                  ← All TypeScript interfaces
    ├── app/
    │   ├── dashboard/page.tsx          ← Server component, fetches deals from Supabase
    │   └── api/
    │       ├── cron/route.ts           ← Main orchestrator (POST, secured by CRON_SECRET)
    │       ├── ebay/route.ts           ← GET /api/ebay?make=Toro&model=Titan — returns comps
    │       └── listings/[id]/route.ts  ← PATCH — update deal status/notes/actual prices
    ├── components/
    │   └── DashboardClient.tsx         ← Full dashboard UI (dark monospace theme)
    └── lib/
        ├── ebay/client.ts              ← eBay OAuth + fetchSoldComps + calculateMarketValue
        ├── scoring/index.ts            ← scoreDeal(), formatDealAlert(), formatDealAlertHTML()
        ├── scrapers/
        │   ├── craigslist.ts           ← Scrapes 8 FL Craigslist markets
        │   └── facebook.ts             ← Apify-based Facebook Marketplace scraper
        ├── alerts.ts                   ← sendSMSAlert(), sendEmailAlert(), sendDealAlerts()
        ├── geo.ts                      ← Haversine distance calculation
        └── supabase.ts                 ← supabase (anon) + supabaseAdmin (service role) clients
```

---

### Supabase Schema (3 tables)

**scored_deals** — every listing found and scored
- Listing data: platform, external_id, title, asking_price, make, model, hours, location, url
- Scoring data: estimated_market_value, profit_potential, profit_percent, deal_score, comp_count, qualifies
- Workflow: status (new/contacted/passed/purchased), alert_sent, notes
- Results: actual_buy_price, actual_sell_price, actual_profit
- Unique constraint: (platform, external_id) — prevents duplicates

**ebay_comps** — sold eBay listings used for pricing (cache layer)

**alert_log** — every alert sent, with channel and status

---

### Deal Scoring Algorithm (0–100)

| Component | Weight | Maxes at |
|-----------|--------|----------|
| Profit percent | 40 pts | 50%+ margin |
| Absolute profit | 40 pts | $2,000+ profit |
| Comp confidence | 20 pts | 20+ eBay sold comps |

A deal **qualifies** (triggers an alert) when ALL three are true:
- profit_potential >= $600
- profit_percent >= 20%
- distance_miles <= 240

---

### eBay API Status

**Credentials: ✅ done** — Production keyset created, keys in `.env.local`

- App ID (Client ID): in `.env.local` as `EBAY_CLIENT_ID`
- Cert ID (Client Secret): in `.env.local` as `EBAY_CLIENT_SECRET`
- Environment: `production`

**Finding API (findCompletedItems):** ✅ auth works, hit rate limit during initial testing
(new accounts have low call quotas that reset within hours — will be fine in production)

**Marketplace Insights API:** ❌ requires "application growth check" approval from eBay —
not worth pursuing. The Finding API fallback handles everything we need.

**Exemption filed:** Selected "I do not persist eBay data" — approved, keyset is active.

Test script: `npx ts-node --project tsconfig.scripts.json scripts/test-ebay.ts`

---

### FL Craigslist Markets Covered

| Market | City | Approx Distance |
|--------|------|-----------------|
| daytona | Daytona Beach | ~5 mi |
| orlando | Orlando | ~60 mi |
| jacksonville | Jacksonville | ~90 mi |
| tampa | Tampa | ~138 mi |
| lakeland | Lakeland | ~100 mi |
| gainesville | Gainesville | ~85 mi |
| ocala | Ocala | ~75 mi |
| treasure | Treasure Coast | ~110 mi |

Scraper targets the `grd` (farm+garden) category with min_price=$500, sorted newest first.
Uses cheerio to parse `li.cl-search-result` elements.

---

### Facebook Marketplace (Apify)

Uses the `apify/facebook-marketplace-scraper` actor. Kicks in automatically when
`APIFY_API_TOKEN` is set in `.env.local`. Cost: ~$5–15/month at our usage level.

The cron job polls the Apify run every 5 seconds (max 3 min wait) then maps results
to our `Listing` type. If Apify isn't configured, Craigslist runs alone.

---

### Vercel Cron

`vercel.json` schedules `/api/cron` every 30 minutes:
```json
{ "crons": [{ "path": "/api/cron", "schedule": "*/30 * * * *" }] }
```

**Important:** Vercel Cron requires the **Pro plan** ($20/mo). On the free Hobby plan,
use an external service like https://cron-job.org to POST to your `/api/cron` endpoint
with the `x-cron-secret` header.

Manual test:
```bash
curl -X POST https://your-vercel-url.vercel.app/api/cron \
  -H "x-cron-secret: your_cron_secret_here"
```

---

### Dashboard Features

- **Stats bar:** Total scraped / Qualified deals / New today / Purchased
- **Filter bar:** By status (new/contacted/passed/purchased), platform, qualified-only toggle
- **Deal rows:** Score (0–100, color-coded), title, platform badge, status dot, location, distance, hours, comp count, asking price, market value, profit potential
- **Detail panel:** Slides in from right — full price breakdown, status buttons, View Listing CTA
- **Status workflow:** new → contacted → passed | purchased
- Design: dark monospace (JetBrains Mono), #080808 background, green profit highlights

---

### Category Expansion Plan

Phase 1 (current): Zero-turn and riding mowers
Phase 2 (planned): Add these high-fit categories — same scraper pattern, new eBay category IDs
- **Golf carts** — Florida is golf cart country, huge volume in the corridor, strong eBay comps
- **Utility trailers** — single to tandem axle, easy to evaluate, high Craigslist volume
- **Commercial pressure washers** — Honda/Kohler engine units, often underpriced, solid comps

Skip for now: push mowers (too cheap), sheds (no eBay comps), consumer generators (thin margins)

Code changes needed for expansion:
- Add search terms to `SEARCH_QUERIES` in `craigslist.ts`
- Add eBay category IDs to `EBAY_CATEGORIES` in `ebay/client.ts`
- Make `fetchSoldComps()` category-aware (currently hardcodes "zero turn mower" in query)

---

### What Still Needs To Be Done

#### Immediate (before first run)
- [x] Get eBay Developer API credentials — done, keys in `.env.local`
- [x] Run `scripts/test-ebay.ts` — auth confirmed working
- [ ] Create Supabase project, run `supabase/migrations/001_initial_schema.sql`
- [ ] Add Supabase keys to `.env.local`
- [ ] Set up Twilio account, get phone number
- [ ] Set up Resend account, verify domain, update `from` address in `src/lib/alerts.ts`
- [ ] Deploy to Vercel: `vercel` CLI or connect GitHub repo
- [ ] Add all env vars to Vercel environment settings
- [ ] Set up cron trigger (Vercel Pro or cron-job.org)

#### Nice to Have / Next Features
- [ ] OfferUp scraper (currently in platform list but scraper not yet built)
- [ ] eBay comp caching — store comps in Supabase `ebay_comps` table to reduce API calls
- [ ] Notes field in deal detail panel (UI exists, no input yet)
- [ ] Actual profit tracking UI — input fields for actual_buy_price / actual_sell_price
- [ ] Deal history / profit summary view
- [ ] Category expansion — golf carts, utility trailers, commercial pressure washers
- [ ] Dealer contact CRM — track which local dealers have used inventory, auto-prompt follow-ups
- [ ] Inspection sheet — mobile form for drivers, AI-generated renegotiation script from results

---

### Key Design Decisions (don't change without reason)

- **Median, not average** for market value — more robust against outlier sale prices
- **Both thresholds required** (% AND $) — prevents alerting on cheap items with high % margins
- **Dedup by (platform, external_id)** — same listing won't be scored twice across cron runs
- **Craigslist always on, Facebook optional** — Apify token presence gates FB scraping
- **Service role key for cron, anon key for client** — never expose service role to browser
- **Score saved to DB** — lets you analyze score distribution over time and tune thresholds
- **Finding API only** — Marketplace Insights requires special eBay approval, not worth it

---

### Owner Context

- **Brian Frahm** — Ormond Beach, FL
- Owns Frahm.agency (boutique creative studio + AI coaching)
- Primary stack: Next.js 14, Supabase, Vercel, Clerk, Twilio, Resend, Anthropic API
- Deploys via Vercel, manages repos via GitHub MCP on Mac mini
- Comfortable with guided, incremental builds — understands the big picture
- This is a personal tool, not a productized SaaS (for now)
