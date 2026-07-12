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
