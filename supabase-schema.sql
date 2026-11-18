-- SAFE TO RE-RUN ON A LIVE DATABASE.
-- Every statement here is idempotent and non-destructive: `create table if not
-- exists` skips tables that already have data, and enabling RLS does not touch
-- rows. There is deliberately no DROP/DELETE/TRUNCATE in this file — never add
-- one, and never paste ad-hoc cleanup SQL in alongside it.

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null,
  report jsonb not null,
  journal jsonb null
);

-- Every scan is stored now, not just the ones someone bought, so a report row
-- carries the person's verdict ('pass' | 'maybe' | 'good', null until they
-- call it) plus the two keys that let a repeat scan be served from here
-- instead of from the model.
alter table reports add column if not exists reaction text null;
alter table reports add column if not exists product_key text null;
alter table reports add column if not exists prefs_fingerprint text null;

create index if not exists reports_scan_cache_idx
  on reports (user_id, product_key, prefs_fingerprint, created_at desc);

create table if not exists user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  preferences jsonb not null,
  updated_at timestamptz not null default now()
);

-- Session logs: "how it actually went", logged after the fact.
-- A session can reference a saved report (the product you bought) or stand
-- alone (strain_name only) for stuff you tried without scanning first.
-- Multiple sessions per report are expected — one purchase, many smokes.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null,
  report_id uuid null references reports(id) on delete set null,
  strain_name text not null default '',
  rating int null check (rating between 1 and 5),
  feelings jsonb null,
  notes text null,
  would_buy_again boolean null,
  -- Opt-in only: null unless the person explicitly tagged a location when
  -- logging. Never populated automatically.
  location_lat double precision null,
  location_lng double precision null
);

-- Additive for databases that already ran this file before location tagging existed.
alter table sessions add column if not exists location_lat double precision null;
alter table sessions add column if not exists location_lng double precision null;

create index if not exists sessions_user_created_idx on sessions (user_id, created_at desc);
create index if not exists reports_user_created_idx on reports (user_id, created_at desc);

-- Cached web-research results per product, so repeat scans of the same item
-- score off identical facts instead of re-rolling a flaky search each time.
-- Not user-specific: the facts about a strain are the same for everyone.
create table if not exists product_facts (
  cache_key text primary key,
  subject text not null,
  context text not null,
  created_at timestamptz not null default now()
);

-- One row per fresh (non-cached) scan, used only to rate-limit the analyze
-- endpoint per identity and per network. ip is a salted hash, never the raw
-- address. Rows older than two days are pruned by the app.
create table if not exists scan_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_key text null,
  ip text not null
);
create index if not exists scan_events_user_idx on scan_events (user_key, created_at desc);
create index if not exists scan_events_ip_idx on scan_events (ip, created_at desc);

-- ---------------------------------------------------------------------------
-- Product catalog. Shared across everyone, and deliberately anonymous:
-- observations carry no user id or report id, so this is a record of what's
-- in products, never of who bought what.
--
-- A product is brand + strain + form (a STIIIZY Blue Dream pod and a STIIIZY
-- Blue Dream eighth are different products). What's in it is not stored on
-- the product: every reading is kept as a dated observation with its source,
-- because batches vary and a label beats a web page beats a model's memory.
-- The app builds the profile from the strongest source available.
create table if not exists brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists strains (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid null references brands(id) on delete set null,
  strain_id uuid null references strains(id) on delete set null,
  product_type text not null default 'unknown',
  canonical_key text not null unique,   -- brand-slug|strain-slug|type
  display_name text not null,
  created_at timestamptz not null default now()
);

-- Every way a product has been asked about ("blue dream stiiizy", the label
-- read off a photo) points at the one product, so the next scan of it can
-- skip the web search.
create table if not exists product_aliases (
  alias_key text primary key,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists product_observations (
  id bigint generated always as identity primary key,
  product_id uuid not null references products(id) on delete cascade,
  source text not null check (source in ('label', 'web', 'typical')),
  thc_pct numeric null,
  cbd_pct numeric null,
  terpenes jsonb not null default '[]'::jsonb,  -- [{ "name": "limonene", "pct": 0.8 | null }]
  strain_type text null,
  observed_at timestamptz not null default now()
);
create index if not exists product_observations_product_idx on product_observations (product_id, observed_at desc);

-- A person's learned taste (terpene affinities, liked lean and potency),
-- rebuilt from their journal and scan reactions whenever those change.
create table if not exists user_taste (
  user_id uuid primary key,
  taste jsonb not null,
  updated_at timestamptz not null default now()
);

-- Each scan now records which catalog product it was, and the deterministic
-- shadow score computed alongside the model's (stored, never shown).
alter table reports add column if not exists product_id uuid null references products(id) on delete set null;
alter table reports add column if not exists shadow_score int null;
alter table reports add column if not exists shadow_version text null;

-- Does either score predict how people actually rated things? One row per
-- journal entry that rated a scanned product. score_calibration_summary turns
-- it into the single number that says whether the app is getting smarter:
-- the correlation between predicted score and the rating that followed.
-- It needs roughly 30 rated rows before it means anything.
create or replace view score_calibration as
select
  s.created_at as rated_at,
  s.user_id,
  s.rating,
  (r.report->>'matchScore')::int as model_score,
  r.shadow_score,
  r.shadow_version,
  r.product_id
from sessions s
join reports r on r.id = s.report_id
where s.rating is not null;

create or replace view score_calibration_summary as
select
  count(*) as rated_scans,
  round(corr(rating, model_score)::numeric, 3) as model_vs_rating,
  round(corr(rating, shadow_score)::numeric, 3) as shadow_vs_rating,
  count(shadow_score) as rated_with_shadow
from score_calibration;

-- The app reads/writes only through server routes using the service role
-- (which bypasses RLS). Enabling RLS with no public policies blocks anyone
-- from querying these tables directly with the public anon key.
alter table reports enable row level security;
alter table sessions enable row level security;
alter table user_preferences enable row level security;
alter table product_facts enable row level security;
alter table scan_events enable row level security;
alter table brands enable row level security;
alter table strains enable row level security;
alter table products enable row level security;
alter table product_aliases enable row level security;
alter table product_observations enable row level security;
alter table user_taste enable row level security;
-- Views run with their owner's rights by default, which would let the public
-- anon key read every rating through them. security_invoker makes them obey
-- the RLS on the underlying tables instead.
alter view score_calibration set (security_invoker = true);
alter view score_calibration_summary set (security_invoker = true);
