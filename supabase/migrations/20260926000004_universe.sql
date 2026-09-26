-- 21MOONS UNIVERSE — additive engagement layer.
-- ONLY creates new tables, indexes, functions and triggers ON NEW TABLES.
-- Does not alter, drop or rewrite any existing table, column, constraint or data.
-- The whole layer ships DISABLED (universe_settings.enabled = false) until an
-- organizer switches it on in Admin → Live Universe.

-- ---------------------------------------------------------------------------
-- Settings + tick state (single row each)
-- ---------------------------------------------------------------------------
create table if not exists universe_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  auto_news boolean not null default true,
  one_to_watch_team_id uuid references teams(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into universe_settings (id) values (1) on conflict (id) do nothing;

create table if not exists universe_state (
  id int primary key default 1 check (id = 1),
  last_tick_at timestamptz not null default 'epoch',
  -- Snapshot of the public leaderboard used to detect leader changes/overtakes.
  snapshot jsonb,
  last_ledger_id bigint,
  updated_at timestamptz not null default now()
);
insert into universe_state (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 📡 LUNAR NETWORK — news feed (never touches the score ledger)
-- ---------------------------------------------------------------------------
create table if not exists live_events (
  id bigint generated always as identity primary key,
  event_type text not null check (char_length(event_type) between 1 and 40),
  emoji text not null default '📡',
  headline text not null check (char_length(headline) between 1 and 140),
  body text check (body is null or char_length(body) <= 400),
  team_id uuid references teams(id) on delete set null,
  target_team_id uuid references teams(id) on delete set null,
  points_delta integer,
  importance text not null default 'normal' check (importance in ('normal','hot','breaking')),
  source text not null default 'system' check (source in ('system','admin')),
  takeover boolean not null default false,
  dedupe_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  published boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists live_events_feed_idx on live_events (created_at desc, id desc) where published and archived_at is null;

-- ---------------------------------------------------------------------------
-- ☄️ COSMIC POWERS
-- ---------------------------------------------------------------------------
create table if not exists challenge_power_rewards (
  challenge_id uuid primary key references challenges(id) on delete cascade,
  powerup_type text not null check (powerup_type in ('SABOTAGE_5','SABOTAGE_10','SHIELD')),
  created_at timestamptz not null default now()
);

create table if not exists team_powerups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  powerup_type text not null check (powerup_type in ('SABOTAGE_5','SABOTAGE_10','SHIELD')),
  value integer not null default 0 check (value between 0 and 100),
  status text not null default 'available' check (status in ('available','used','revoked')),
  source text not null default 'admin' check (source in ('admin','challenge')),
  earned_from_challenge_id uuid references challenges(id) on delete set null,
  earned_from_submission_id uuid references challenge_submissions(id) on delete cascade,
  earned_at timestamptz not null default now(),
  used_at timestamptz,
  target_team_id uuid references teams(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists team_powerups_team_idx on team_powerups (team_id, status);
-- One reward per approved submission (idempotent reward granting).
create unique index if not exists team_powerups_one_per_submission
  on team_powerups (earned_from_submission_id) where earned_from_submission_id is not null;

create table if not exists power_attacks (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,                 -- client idempotency key (double-click/replay)
  powerup_id uuid not null unique references team_powerups(id) on delete cascade,
  attacker_team_id uuid not null references teams(id) on delete cascade,
  target_team_id uuid not null references teams(id) on delete cascade,
  powerup_type text not null,
  requested_delta integer not null,
  applied_delta integer not null,
  blocked boolean not null default false,
  shield_powerup_id uuid references team_powerups(id) on delete set null,
  ledger_id bigint references score_ledger(id) on delete set null,  -- demo purge must keep working
  created_at timestamptz not null default now(),
  check (attacker_team_id <> target_team_id)
);
create index if not exists power_attacks_attacker_idx on power_attacks (attacker_team_id, created_at);

-- ---------------------------------------------------------------------------
-- 🌌 COSMIC EVENTS — system may SUGGEST; only an admin can GO LIVE.
-- ---------------------------------------------------------------------------
create table if not exists chaos_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ECLIPSE','SOLAR_FLARE','BLACK_HOLE','WORMHOLE','ANOMALY','HUNT_THE_LEADER','CONTENT_STORM')),
  status text not null default 'draft' check (status in ('draft','suggested','live','ended','cancelled')),
  title text not null check (char_length(title) between 1 and 80),
  explanation text not null default '' check (char_length(explanation) <= 300),
  reason text,
  suggestion_key text unique,
  buildup_seconds integer not null default 0 check (buildup_seconds in (0, 30, 60, 180, 300)),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 240),
  points integer check (points is null or points between 0 and 1000),
  linked_challenge_id uuid references challenges(id) on delete set null,
  approved_at timestamptz,
  goes_live_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one live cosmic event at a time.
create unique index if not exists chaos_events_one_live on chaos_events ((true)) where status = 'live';

-- ---------------------------------------------------------------------------
-- Realtime: reuse the existing data-free signal (triggers only on NEW tables).
-- ---------------------------------------------------------------------------
drop trigger if exists signal_live_events on live_events;
create trigger signal_live_events after insert or update on live_events
  for each statement execute function bump_live_signal('public','admin');
drop trigger if exists signal_chaos_events on chaos_events;
create trigger signal_chaos_events after insert or update on chaos_events
  for each statement execute function bump_live_signal('public','admin');
drop trigger if exists signal_team_powerups on team_powerups;
create trigger signal_team_powerups after insert or update on team_powerups
  for each statement execute function bump_live_signal('admin');
drop trigger if exists signal_universe_settings on universe_settings;
create trigger signal_universe_settings after update on universe_settings
  for each statement execute function bump_live_signal('public','admin');

-- ---------------------------------------------------------------------------
-- Lock down the Supabase Data API for the new tables (server-only access).
-- ---------------------------------------------------------------------------
alter table universe_settings enable row level security;
alter table universe_state enable row level security;
alter table live_events enable row level security;
alter table challenge_power_rewards enable row level security;
alter table team_powerups enable row level security;
alter table power_attacks enable row level security;
alter table chaos_events enable row level security;

do $$
declare r text; t text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach t in array array['universe_settings','universe_state','live_events','challenge_power_rewards','team_powerups','power_attacks','chaos_events'] loop
        execute format('revoke all on table public.%I from %I', t, r);
      end loop;
      execute format('revoke all on all sequences in schema public from %I', r);
    end if;
  end loop;
end $$;
