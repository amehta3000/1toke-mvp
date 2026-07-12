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
  would_buy_again boolean null
);

create index if not exists sessions_user_created_idx on sessions (user_id, created_at desc);
create index if not exists reports_user_created_idx on reports (user_id, created_at desc);
