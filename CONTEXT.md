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

**Core loop — two-phase architecture:**

**Phase 1 — Scrape (every 30 min via cron-job.org → /api/cron):**
1. Scrape Craigslist (8 FL markets) and Facebook Marketplace (via Apify) for listings
2. Save new listings to Supabase with zeroed scores (comp_count=0)
3. No eBay calls — fast and rate-limit-proof

**Phase 2 — Score (every 4 hours via cron-job.org → /api/score):**
1. Fetch up to 10 unscored listings (comp_count=0) from Supabase
2. Call eBay Finding API for each with 2-second delay between calls
3. Update scores in Supabase
4. Send alerts for qualifying deals
5. If eBay rate limits, stop gracefully — next run picks up where it left off

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
- **Deployment:** Vercel Hobby plan at https://deal-scout-2.vercel.app
- **Scraping:** Cheerio for Craigslist, Apify actor for Facebook Marketplace
- **Pricing data:** eBay Finding API (findCompletedItems — sold listings only)
- **Alerts:** Twilio SMS + Resend email
- **Language:** TypeScript throughout
- **Cron:** cron-job.org (two jobs — scrape every 30min, score every 4hrs)

**GitHub repo:** https://github.com/brian23662/deal-scout

**Important local path:** The repo is at `~/Projects/deal-scout/deal-scout` (double-nested).
Always `cd ~/Projects/deal-scout/deal-scout` before running any git or npm commands.

---

### File Structure

```
deal-scout/
├── .env.example                        ← All required env vars documented here
├── scripts/
│   ├── test-ebay.ts                    ← Run this to verify eBay API works
│   ├── local-scraper.ts                ← Standalone local scraper (for testing)
│   └── com.dealscout.scraper.plist     ← macOS launchd config (unused)
├── supabase/migrations/
│   └── 001_initial_schema.sql          ← Run in Supabase SQL Editor to create tables
└── src/
    ├── types/index.ts                  ← All TypeScript interfaces
    ├── app/
    │   ├── dashboard/page.tsx          ← Server component, fetches deals from Supabase
    │   └── api/
    │       ├── cron/route.ts           ← Phase 1: scrape only, no eBay calls
    │       ├── score/route.ts          ← Phase 2: score unscored listings against eBay
    │       ├── ebay/route.ts           ← GET /api/ebay?make=Toro&model=Titan — returns comps
    │       └── listings/[id]/route.ts  ← PATCH — update deal status/notes/actual prices
    ├── components/
    │   └── DashboardClient.tsx         ← Full dashboard UI (dark monospace theme)
    └── lib/
        ├── ebay/client.ts              ← eBay OAuth + fetchSoldComps + calculateMarketValue
        ├── scoring/index.ts            ← scoreDeal(), formatDealAlert(), formatDealAlertHTML()
        ├── scrapers/
        │   ├── craigslist.ts           ← Scrapes 8 FL Craigslist markets (5 categories each)
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
- **comp_count=0 means unscored** — used by /api/score to find work to do

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

**Finding API (findCompletedItems):** ✅ auth works. Rate limited (error 10001) during
testing — quota resets overnight. In production the two-phase approach makes only ~60
calls/day (10 listings × 6 score runs) which is well within limits.

**Marketplace Insights API:** ❌ requires "application growth check" approval from eBay —
not worth pursuing. The Finding API fallback handles everything we need.

**Exemption filed:** Selected "I do not persist eBay data" — approved, keyset is active.

**IMPORTANT:** Do NOT keep running the test script while rate limited — each run burns quota.
Test script: `npx ts-node --project tsconfig.scripts.json scripts/test-ebay.ts`

---

### cron-job.org Setup (two jobs)

| Job | URL | Schedule | Status |
|-----|-----|----------|--------|
| Deal Scout (scrape) | https://deal-scout-2.vercel.app/api/cron | Every 30 min | **Disabled — re-enable when eBay quota resets** |
| Deal Scout - Score | https://deal-scout-2.vercel.app/api/score | Every 4 hours | Enabled |

Both jobs use `x-cron-secret` header (not HTTP Basic Auth) with POST method.

**Next step:** When eBay quota resets (check with test script), re-enable the scrape job.
Listings will appear on dashboard immediately; scores will populate within 4 hours.

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

Scraper covers 5 categories per market: Farm & Garden, Appliances, Tools, Business/Commercial,
Sporting Goods. 8 markets × 5 categories = 40 requests per cron run.
Uses cheerio to parse JSON-LD embedded in Craigslist search pages.

---

### Facebook Marketplace (Apify)

Uses the `apify/facebook-marketplace-scraper` actor. Kicks in automatically when
`APIFY_API_TOKEN` is set in `.env.local`. Cost: ~$5–15/month at our usage level.

The cron job polls the Apify run every 5 seconds (max 3 min wait) then maps results
to our `Listing` type. If Apify isn't configured, Craigslist runs alone.

---

### Dashboard

Live at: https://deal-scout-2.vercel.app/dashboard

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

#### Immediate (next session)
- [ ] Verify eBay quota has reset: `npx ts-node --project tsconfig.scripts.json scripts/test-ebay.ts`
- [ ] Re-enable the scrape job on cron-job.org
- [ ] Confirm listings appear on dashboard and scores populate within 4 hours

#### Not Yet Configured (non-blocking)
- [ ] Twilio SMS alerts — fails gracefully when not configured
- [ ] Resend email alerts — fails gracefully when not configured

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

- **Two-phase architecture** — scrape and score are separate endpoints/jobs to avoid eBay rate limits
- **comp_count=0 = unscored** — /api/score uses this to find listings needing eBay lookups
- **Batch size 10, 2s delay** — /api/score processes 10 listings per run with 2s between eBay calls
- **Graceful rate limit handling** — if eBay returns error 10001, /api/score stops and resumes next run
- **Median, not average** for market value — more robust against outlier sale prices
- **Both thresholds required** (% AND $) — prevents alerting on cheap items with high % margins
- **Dedup by (platform, external_id)** — same listing won't be scored twice across cron runs
- **Craigslist always on, Facebook optional** — Apify token presence gates FB scraping
- **Service role key for cron, anon key for client** — never expose service role to browser
- **Score saved to DB** — lets you analyze score distribution over time and tune thresholds
- **Finding API only** — Marketplace Insights requires special eBay approval, not worth it

---

### Key Learnings & Gotchas

- **Double-nested repo:** Local path is `~/Projects/deal-scout/deal-scout` — always cd into the inner folder
- **eBay rate limit error shape:** surfaces as top-level `errorMessage` key, not inside `findCompletedItemsResponse` wrapper
- **cron-job.org auth:** must use custom `x-cron-secret` header, NOT HTTP Basic Auth
- **Vercel URL:** https://deal-scout-2.vercel.app (not deal-scout.vercel.app)

---

### Owner Context

- **Brian Frahm** — Ormond Beach, FL
- Owns Frahm.agency (boutique creative studio + AI coaching)
- Primary stack: Next.js 14, Supabase, Vercel, Clerk, Twilio, Resend, Anthropic API
- Deploys via Vercel, manages repos via GitHub MCP on Mac mini
- Comfortable with guided, incremental builds — understands the big picture
- This is a personal tool, not a productized SaaS (for now)
