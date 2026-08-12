create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null,
  report jsonb not null,
  journal jsonb null
);

create table if not exists user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  preferences jsonb not null default '{}'::jsonb,
  -- Learned preference vector: PreferenceKey -> score in [-1, 1], nudged by
  -- every rated session (see lib/preferenceVector.ts). Distinct from the
  -- onboarding toggles above — this is what closes the feedback loop.
  vector jsonb not null default '{}'::jsonb,
  sample_count int not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists user_preferences_user_id_idx on user_preferences (user_id);

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
  would_buy_again boolean null
);

create index if not exists sessions_user_created_idx on sessions (user_id, created_at desc);
create index if not exists reports_user_created_idx on reports (user_id, created_at desc);

-- The app reads/writes only through server routes using the service role
-- (which bypasses RLS). Enabling RLS with no public policies blocks anyone
-- from querying these tables directly with the public anon key.
alter table reports enable row level security;
alter table sessions enable row level security;
alter table user_preferences enable row level security;
