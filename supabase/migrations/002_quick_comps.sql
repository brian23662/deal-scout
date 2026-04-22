-- Deal Scout - Quick Comp table
-- Paste this into your Supabase SQL Editor and click Run

create table if not exists quick_comps (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_url text not null,
  source_domain text,
  title text,
  asking_price numeric,
  ebay_query text,
  comps jsonb,                    -- array of {title, price, url, endedAt}
  comp_count integer,
  median_price numeric,
  estimated_profit numeric,
  extraction_method text,         -- 'craigslist' | 'ebay' | 'govdeals' | 'hibid' | 'opengraph' | 'jsonld' | 'manual'
  notes text
);

create index if not exists idx_quick_comps_created on quick_comps (created_at desc);
create index if not exists idx_quick_comps_domain on quick_comps (source_domain);

alter table quick_comps enable row level security;
create policy "Service role full access" on quick_comps for all using (auth.role() = 'service_role');
