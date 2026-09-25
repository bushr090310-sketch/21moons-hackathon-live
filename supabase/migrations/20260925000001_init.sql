-- 21MOONS Hackathon Live — core schema
-- The server connects as the database owner. All tables have RLS enabled with
-- NO policies for anon/authenticated, except `live_signals` (a data-free
-- "something changed" counter used for Supabase Realtime).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type challenge_type as enum ('FIRST_GLOBAL','OPEN_ONCE','REPEATABLE','COMPETITIVE','JUDGED','VOTE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type award_mode as enum ('on_approval','on_finalize','on_vote');
exception when duplicate_object then null; end $$;

do $$ begin
  -- draft: hidden; scheduled: becomes visible at reveal_at; live: visible now;
  -- locked: visible but closed; archived: hidden and retired.
  create type challenge_status as enum ('draft','scheduled','live','locked','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type submission_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ledger_type as enum ('challenge_award','final_award','vote_award','manual_adjustment','reversal');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Event settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists event_settings (
  id int primary key default 1 check (id = 1),
  event_name text not null default '21MOONS Hackathon',
  event_location text not null default 'Malmö, Sweden',
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  sponsors jsonb not null default '[]'::jsonb,
  announcement text,
  leaderboard_frozen boolean not null default false,
  frozen_at timestamptz,
  revealed_at timestamptz,
  voting_state text not null default 'not_open' check (voting_state in ('not_open','open','closed')),
  voting_results_public boolean not null default false,
  submissions_open boolean not null default true,
  show_first_global_winner boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Teams & participants
-- ---------------------------------------------------------------------------
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  slug text not null unique,
  description text check (description is null or char_length(description) <= 280),
  score_cached integer not null default 0,
  last_scored_at timestamptz,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists team_secrets (
  team_id uuid primary key references teams(id) on delete cascade,
  access_code_hash text not null,
  session_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  vote_code_hash text unique,
  created_at timestamptz not null default now()
);
create index if not exists participants_team_idx on participants(team_id);

-- ---------------------------------------------------------------------------
-- Challenges
-- ---------------------------------------------------------------------------
create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  slug text not null unique,
  emoji text not null default '✨',
  short_description text not null default '',
  full_description text not null default '',
  points integer not null check (points between -1000 and 1000),
  challenge_type challenge_type not null,
  award_mode award_mode not null,
  status challenge_status not null default 'draft',
  reveal_at timestamptz,
  expires_at timestamptz,
  is_secret boolean not null default false,
  max_completions_per_team integer not null default 1 check (max_completions_per_team between 1 and 100),
  accepts_submissions boolean not null default true,
  sort_order integer not null default 0,
  evidence_config jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_needs_reveal check (status <> 'scheduled' or reveal_at is not null)
);

-- ---------------------------------------------------------------------------
-- Submissions ("applications")
-- ---------------------------------------------------------------------------
create table if not exists challenge_submissions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  challenge_id uuid not null references challenges(id) on delete restrict,
  team_id uuid not null references teams(id) on delete cascade,
  status submission_status not null default 'pending',
  description text not null check (char_length(description) between 1 and 2000),
  evidence_url text check (evidence_url is null or char_length(evidence_url) <= 1000),
  numeric_value numeric,
  verified_value numeric,
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  review_note text,
  awarded_units integer not null default 0
);
create index if not exists submissions_challenge_idx on challenge_submissions(challenge_id, status, submitted_at, seq);
create index if not exists submissions_team_idx on challenge_submissions(team_id, challenge_id);
-- A team may only have ONE pending application per challenge at a time.
create unique index if not exists submissions_one_pending
  on challenge_submissions(challenge_id, team_id) where status = 'pending';

create table if not exists submission_files (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  submission_id uuid references challenge_submissions(id) on delete cascade,
  storage_path text not null unique,
  original_name text,
  mime text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 8388608),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists submission_files_sub_idx on submission_files(submission_id);

-- Only used when Supabase Storage is not configured (local development / tests).
create table if not exists local_evidence_objects (
  storage_path text primary key,
  mime text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Score ledger — canonical, append-only
-- ---------------------------------------------------------------------------
create table if not exists score_ledger (
  id bigint generated always as identity primary key,
  team_id uuid not null references teams(id) on delete cascade,
  challenge_id uuid references challenges(id) on delete restrict,
  submission_id uuid references challenge_submissions(id) on delete restrict,
  points_delta integer not null check (points_delta <> 0),
  entry_type ledger_type not null,
  reason text not null check (char_length(reason) between 1 and 500),
  public_label text not null,
  award_key text unique,
  reverses_id bigint unique references score_ledger(id),
  created_at timestamptz not null default now()
);
create index if not exists ledger_team_idx on score_ledger(team_id, created_at);
create index if not exists ledger_created_idx on score_ledger(created_at desc, id desc);

create or replace function ledger_apply_to_cache() returns trigger language plpgsql as $$
begin
  update teams
     set score_cached = score_cached + new.points_delta,
         last_scored_at = new.created_at,
         updated_at = now()
   where id = new.team_id;
  return new;
end $$;

drop trigger if exists ledger_apply_to_cache on score_ledger;
create trigger ledger_apply_to_cache after insert on score_ledger
  for each row execute function ledger_apply_to_cache();

create or replace function ledger_forbid_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.allow_demo_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'score_ledger is append-only; create a compensating entry instead';
end $$;

drop trigger if exists ledger_forbid_mutation on score_ledger;
create trigger ledger_forbid_mutation before update or delete on score_ledger
  for each row execute function ledger_forbid_mutation();

-- ---------------------------------------------------------------------------
-- People's Choice votes
-- ---------------------------------------------------------------------------
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references participants(id) on delete cascade,
  voted_team_id uuid not null references teams(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function votes_forbid_own_team() returns trigger language plpgsql as $$
declare own uuid;
begin
  select team_id into own from participants where id = new.participant_id;
  if own is null then
    raise exception 'unknown participant';
  end if;
  if own = new.voted_team_id then
    raise exception 'participants cannot vote for their own team' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists votes_forbid_own_team on votes;
create trigger votes_forbid_own_team before insert or update on votes
  for each row execute function votes_forbid_own_team();

-- ---------------------------------------------------------------------------
-- Audit log & auth throttling
-- ---------------------------------------------------------------------------
create table if not exists admin_audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_created_idx on admin_audit_log(created_at desc);

create table if not exists auth_attempts (
  id bigint generated always as identity primary key,
  kind text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_idx on auth_attempts(kind, key, created_at);

-- ---------------------------------------------------------------------------
-- Live signals (Realtime invalidation). Contains NO event data.
-- ---------------------------------------------------------------------------
create table if not exists live_signals (
  channel text primary key,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into live_signals(channel) values ('public'), ('admin') on conflict do nothing;

create or replace function bump_live_signal() returns trigger language plpgsql as $$
begin
  update live_signals set version = version + 1, updated_at = now()
   where channel = any (tg_argv);
  return null;
end $$;

drop trigger if exists signal_ledger on score_ledger;
create trigger signal_ledger after insert on score_ledger
  for each statement execute function bump_live_signal('public','admin');
drop trigger if exists signal_challenges on challenges;
create trigger signal_challenges after insert or update or delete on challenges
  for each statement execute function bump_live_signal('public','admin');
drop trigger if exists signal_settings on event_settings;
create trigger signal_settings after insert or update on event_settings
  for each statement execute function bump_live_signal('public','admin');
drop trigger if exists signal_teams on teams;
create trigger signal_teams after insert or delete or update of name, active, slug on teams
  for each statement execute function bump_live_signal('public','admin');
drop trigger if exists signal_submissions on challenge_submissions;
create trigger signal_submissions after insert or update or delete on challenge_submissions
  for each statement execute function bump_live_signal('admin');
drop trigger if exists signal_votes on votes;
create trigger signal_votes after insert or update or delete on votes
  for each statement execute function bump_live_signal('admin');

-- ---------------------------------------------------------------------------
-- Row Level Security: lock everything down for the Supabase Data API.
-- ---------------------------------------------------------------------------
alter table event_settings enable row level security;
alter table teams enable row level security;
alter table team_secrets enable row level security;
alter table participants enable row level security;
alter table challenges enable row level security;
alter table challenge_submissions enable row level security;
alter table submission_files enable row level security;
alter table local_evidence_objects enable row level security;
alter table score_ledger enable row level security;
alter table votes enable row level security;
alter table admin_audit_log enable row level security;
alter table auth_attempts enable row level security;
alter table live_signals enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('grant select on table public.live_signals to %I', r);
    end if;
  end loop;
end $$;

drop policy if exists live_signals_read on live_signals;
create policy live_signals_read on live_signals for select using (true);

-- Add live_signals to the Supabase Realtime publication when present.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.live_signals;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

insert into event_settings (id, event_starts_at, event_ends_at, sponsors)
values (
  1,
  '2026-09-26 09:00:00 Europe/Stockholm'::timestamptz,
  '2026-09-26 19:00:00 Europe/Stockholm'::timestamptz,
  '["Lovable","ElevenLabs","Latitude 65","Amass","n8n","Saltis","Prelint","Rankad.ai"]'::jsonb
) on conflict (id) do nothing;
