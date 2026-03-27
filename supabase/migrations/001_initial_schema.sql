-- Deal Scout - Supabase Schema
-- Paste this into your Supabase SQL Editor and click Run

create table if not exists scored_deals (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('craigslist', 'facebook', 'ebay', 'offerup')),
  external_id text not null,
  title text not null,
  asking_price numeric not null,
  make text,
  model text,
  hours integer,
  condition text,
  location_city text,
  location_state text,
  location_zip text,
  distance_miles integer,
  url text not null,
  image_urls text[],
  posted_at timestamptz,
  scraped_at timestamptz default now(),
  estimated_market_value numeric,
  profit_potential numeric,
  profit_percent numeric,
  deal_score integer,
  comp_count integer,
  qualifies boolean default false,
  status text not null default 'new' check (status in ('new', 'contacted', 'passed', 'purchased')),
  alert_sent boolean default false,
  notes text,
  actual_buy_price numeric,
  actual_sell_price numeric,
  actual_profit numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(platform, external_id)
);

create table if not exists ebay_comps (
  id uuid primary key default gen_random_uuid(),
  ebay_item_id text unique not null,
  title text not null,
  make text,
  model text,
  hours integer,
  condition text,
  sold_price numeric not null,
  sold_date timestamptz not null,
  location text,
  url text,
  created_at timestamptz default now()
);

create table if not exists alert_log (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references scored_deals(id),
  channel text not null check (channel in ('sms', 'email')),
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_at timestamptz default now()
);

create index if not exists idx_scored_deals_status on scored_deals(status);
create index if not exists idx_scored_deals_qualifies on scored_deals(qualifies);
create index if not exists idx_scored_deals_platform on scored_deals(platform);
create index if not exists idx_scored_deals_created on scored_deals(created_at desc);
create index if not exists idx_scored_deals_score on scored_deals(deal_score desc);
create index if not exists idx_ebay_comps_make_model on ebay_comps(make, model);
create index if not exists idx_ebay_comps_sold_date on ebay_comps(sold_date desc);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger scored_deals_updated_at
  before update on scored_deals
  for each row execute function update_updated_at();

alter table scored_deals enable row level security;
alter table ebay_comps enable row level security;
alter table alert_log enable row level security;

create policy "Service role full access" on scored_deals for all using (auth.role() = 'service_role');
create policy "Service role full access" on ebay_comps for all using (auth.role() = 'service_role');
create policy "Service role full access" on alert_log for all using (auth.role() = 'service_role');
