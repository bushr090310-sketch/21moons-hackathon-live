-- =====================================================================
-- 21Moons CRM — initial schema
-- Purely additive: creates new objects only. Nothing is dropped.
--
-- Model:
--   people (1 per email)  ──< hackathon_participants >── hackathons
--   people               ──< project_members >──────── projects ──> hackathons (origin)
--   people / projects    ──< person_tags / project_tags >── tags (skill | tool | technology)
--   people               ──< profile_documents (files in private bucket)
--
-- Access model:
--   admin       full access (incl. hackathons, CVs, deletes, role management)
--   staff       read/edit people + projects (no CVs, no hard deletes)
--   participant (any signed-in user without a role row) own profile + own projects only
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- 0. Shared trigger: updated_at / updated_by
-- ---------------------------------------------------------------------
create or replace function public.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 1. App roles (admin / staff). Participants have no row.
--    Bootstrap admins with SQL after they sign up (see seed.sql).
-- ---------------------------------------------------------------------
create table public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles
                 where user_id = (select auth.uid()) and role = 'admin');
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles
                 where user_id = (select auth.uid()) and role in ('admin', 'staff'));
$$;

-- ---------------------------------------------------------------------
-- 2. CRM roles (controlled list, editable as data — no migration needed)
-- ---------------------------------------------------------------------
create table public.roles (
  id         smallint generated always as identity primary key,
  slug       text not null unique check (slug ~ '^[a-z0-9_]+$'),
  label      text not null,
  sort_order int  not null default 100,
  is_active  boolean not null default true
);

insert into public.roles (slug, label, sort_order) values
  ('founder', 'Founder', 10), ('developer', 'Developer', 20), ('designer', 'Designer', 30),
  ('product', 'Product', 40), ('marketing', 'Marketing', 50), ('sales', 'Sales', 60),
  ('growth', 'Growth', 70), ('operations', 'Operations', 80), ('finance', 'Finance', 90),
  ('research', 'Research', 100), ('ai_ml', 'AI / ML', 110), ('data', 'Data', 120),
  ('hardware', 'Hardware', 130), ('investor', 'Investor', 140), ('advisor', 'Advisor', 150),
  ('mentor', 'Mentor', 160), ('operator', 'Operator', 170), ('other', 'Other', 999);

-- ---------------------------------------------------------------------
-- 3. People — separate from auth. auth_user_id is linked on first
--    sign-in with a CONFIRMED matching email (see link_auth_user()).
-- ---------------------------------------------------------------------
create table public.people (
  id                  uuid primary key default gen_random_uuid(),
  auth_user_id        uuid unique references auth.users(id) on delete set null,
  email               text not null unique
                      check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name           text check (char_length(full_name) <= 120),
  phone               text check (char_length(phone) <= 40),
  avatar_path         text,

  primary_role_id     smallint references public.roles(id),
  secondary_role_id   smallint references public.roles(id),
  headline            text check (char_length(headline) <= 160),
  short_bio           text check (char_length(short_bio) <= 2000),
  experience_summary  text check (char_length(experience_summary) <= 4000),
  years_experience    smallint check (years_experience between 0 and 80),

  linkedin_url        text check (linkedin_url  ~* '^https?://'),
  github_url          text check (github_url    ~* '^https?://'),
  portfolio_url       text check (portfolio_url ~* '^https?://'),
  website_url         text check (website_url   ~* '^https?://'),

  location            text check (char_length(location) <= 120),
  timezone            text check (char_length(timezone) <= 64),
  employment_status   text check (employment_status in
                        ('employed', 'self_employed', 'founder', 'student', 'between_roles', 'other')),
  availability_status text check (availability_status in ('available', 'open', 'limited', 'unavailable')),
  hours_per_week      smallint check (hours_per_week between 0 and 80),
  open_to             text[] not null default '{}' check (open_to <@ array[
                        'projects', 'employment', 'cofounding', 'freelance',
                        'advising', 'investing', 'mentoring']::text[]),
  additional_info     text check (char_length(additional_info) <= 4000),

  -- GDPR
  privacy_consent_at  timestamptz,
  sharing_opt_ins     text[] not null default '{}' check (sharing_opt_ins <@ array[
                        'investors', 'recruiters', 'partners', 'participants']::text[]),
  sharing_consent_at  timestamptz,

  source              text not null default 'self'
                      check (source in ('self', 'admin', 'import', 'teammate_invite')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null
);

create index people_full_name_trgm on public.people using gin (full_name extensions.gin_trgm_ops);
create index people_location_trgm  on public.people using gin (location  extensions.gin_trgm_ops);
create index people_open_to_idx    on public.people using gin (open_to);
create index people_primary_role_idx on public.people (primary_role_id);
create index people_availability_idx on public.people (availability_status);
create index people_created_at_idx   on public.people (created_at);

-- Normalise email; participants cannot change email / auth link / source.
create or replace function public.people_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := lower(btrim(new.email));
  if tg_op = 'UPDATE' and current_user = 'authenticated' and not public.is_staff() then
    if new.email is distinct from old.email
       or new.auth_user_id is distinct from old.auth_user_id
       or new.source is distinct from old.source then
      raise exception 'email, account link and source can only be changed by staff'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger people_before_write before insert or update on public.people
  for each row execute function public.people_before_write();
create trigger people_touch before update on public.people
  for each row execute function public.touch_row();

create or replace function public.my_person_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.people where auth_user_id = (select auth.uid());
$$;

-- Link (or create) a person when an auth user has a CONFIRMED email.
-- Unconfirmed emails never claim an existing profile.
create or replace function public.link_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;

  update public.people
     set auth_user_id = new.id
   where email = lower(btrim(new.email)) and auth_user_id is null;

  if not found then
    insert into public.people (email, full_name, auth_user_id, source, created_by)
    values (lower(btrim(new.email)),
            coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
            new.id, 'self', new.id)
    on conflict (email) do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.link_auth_user();
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.link_auth_user();

-- ---------------------------------------------------------------------
-- 4. Hackathons + participation
-- ---------------------------------------------------------------------
create table public.hackathons (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name        text not null check (char_length(name) between 1 and 200),
  starts_on   date,
  ends_on     date,
  location    text,
  description text,
  status      text not null default 'upcoming'
              check (status in ('upcoming', 'active', 'completed', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by  uuid references auth.users(id) on delete set null,
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create trigger hackathons_touch before update on public.hackathons
  for each row execute function public.touch_row();

create table public.hackathon_participants (
  hackathon_id uuid not null references public.hackathons(id) on delete restrict,
  person_id    uuid not null references public.people(id) on delete cascade,
  status       text not null default 'registered'
               check (status in ('registered', 'checked_in', 'no_show', 'withdrawn')),
  source       text not null default 'self' check (source in ('self', 'admin', 'import')),
  external_ref text,          -- e.g. the guest ID from Luma
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (hackathon_id, person_id)
);
create index hackathon_participants_person_idx on public.hackathon_participants (person_id);

-- ---------------------------------------------------------------------
-- 5. Projects + members
-- ---------------------------------------------------------------------
create table public.projects (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 1 and 120),
  tagline             text check (char_length(tagline) <= 200),
  description         text check (char_length(description) <= 5000),
  problem             text check (char_length(problem) <= 3000),
  solution            text check (char_length(solution) <= 3000),
  category            text check (char_length(category) <= 60),

  stage               text not null default 'idea'
                      check (stage in ('idea', 'building', 'mvp', 'launched', 'has_users', 'has_revenue')),
  status              text not null default 'active'
                      check (status in ('active', 'paused', 'abandoned')),
  origin_hackathon_id uuid references public.hackathons(id) on delete restrict,
  continuing_after_hackathon boolean,
  follow_up_status    text not null default 'none'   -- internal 21Moons field (staff only)
                      check (follow_up_status in ('none', 'to_contact', 'contacted', 'in_progress', 'closed')),

  github_url          text check (github_url       ~* '^https?://'),
  live_url            text check (live_url         ~* '^https?://'),
  demo_url            text check (demo_url         ~* '^https?://'),
  presentation_url    text check (presentation_url ~* '^https?://'),

  -- Traction (all optional)
  users_count         int check (users_count >= 0),
  customers_count     int check (customers_count >= 0),
  pilots_count        int check (pilots_count >= 0),
  meetings_count      int check (meetings_count >= 0),
  commitments_count   int check (commitments_count >= 0),
  revenue_amount      numeric(12, 2) check (revenue_amount >= 0),
  revenue_currency    char(3) default 'SEK' check (revenue_currency ~ '^[A-Z]{3}$'),
  traction_notes      text check (char_length(traction_notes) <= 4000),
  next_steps          text check (char_length(next_steps) <= 4000),

  -- Admin housekeeping (staff only)
  merged_into_id      uuid references public.projects(id) on delete set null,
  archived_at         timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null
);

create index projects_name_trgm      on public.projects using gin (name extensions.gin_trgm_ops);
create index projects_hackathon_idx  on public.projects (origin_hackathon_id);
create index projects_stage_idx      on public.projects (stage);
create index projects_category_idx   on public.projects (category);
create index projects_created_at_idx on public.projects (created_at);

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_row();

-- Participants cannot edit internal follow-up / merge / archive fields.
create or replace function public.projects_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not public.is_staff() then
    if tg_op = 'INSERT' then
      new.follow_up_status := 'none';
      new.merged_into_id := null;
      new.archived_at := null;
    elsif new.follow_up_status is distinct from old.follow_up_status
       or new.merged_into_id is distinct from old.merged_into_id
       or new.archived_at is distinct from old.archived_at then
      raise exception 'follow-up, merge and archive fields are staff-only' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger projects_guard before insert or update on public.projects
  for each row execute function public.projects_guard();

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  person_id  uuid not null references public.people(id) on delete cascade,
  team_role  text not null default 'other'
             check (team_role in ('founder', 'developer', 'designer', 'product', 'marketing', 'sales', 'other')),
  is_lead    boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (project_id, person_id)
);
create index project_members_person_idx on public.project_members (person_id);

create or replace function public.is_project_member(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members pm
    join public.people p on p.id = pm.person_id
    where pm.project_id = p_project_id and p.auth_user_id = (select auth.uid()));
$$;

-- A participant who creates a project becomes its lead member.
create or replace function public.add_creator_as_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_person uuid;
begin
  if public.is_staff() then
    return new;   -- staff creating on behalf of a team are not added
  end if;
  select id into v_person from public.people where auth_user_id = new.created_by;
  if v_person is not null then
    insert into public.project_members (project_id, person_id, team_role, is_lead, created_by)
    values (new.id, v_person, 'founder', true, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger projects_add_creator after insert on public.projects
  for each row execute function public.add_creator_as_member();

-- ---------------------------------------------------------------------
-- 6. Tags: skills / tools / technologies (one table, typed).
--    Anyone signed in can add a tag; it is unapproved until staff approve.
-- ---------------------------------------------------------------------
create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('skill', 'tool', 'technology')),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  approved   boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null
);
create unique index tags_type_name_key on public.tags (type, lower(btrim(name)));
create index tags_name_trgm on public.tags using gin (name extensions.gin_trgm_ops);

create table public.person_tags (
  person_id uuid not null references public.people(id) on delete cascade,
  tag_id    uuid not null references public.tags(id)   on delete cascade,
  primary key (person_id, tag_id)
);
create index person_tags_tag_idx on public.person_tags (tag_id);

create table public.project_tags (
  project_id uuid not null references public.projects(id) on delete cascade,
  tag_id     uuid not null references public.tags(id)     on delete cascade,
  primary key (project_id, tag_id)
);
create index project_tags_tag_idx on public.project_tags (tag_id);

-- ---------------------------------------------------------------------
-- 7. Profile documents (CV / LinkedIn PDF). Files live in the private
--    bucket 'profile-documents' at <person_id>/<uuid>-<filename>.
-- ---------------------------------------------------------------------
create table public.profile_documents (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references public.people(id) on delete cascade,
  kind         text not null default 'cv' check (kind in ('cv', 'linkedin_pdf', 'other')),
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes between 0 and 10485760),
  uploaded_at  timestamptz not null default now(),
  uploaded_by  uuid default auth.uid() references auth.users(id) on delete set null,
  check (storage_path like person_id::text || '/%')
);
create index profile_documents_person_idx on public.profile_documents (person_id);

-- =====================================================================
-- 8. RPCs
-- =====================================================================

-- Add a teammate by email. Creates a stub person if the email is new;
-- the stub is linked automatically when they sign in with that email.
-- Returns nothing, so it never reveals whether an email already exists.
create or replace function public.add_project_member(
  p_project_id uuid, p_email text, p_team_role text default 'other', p_full_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email  text := lower(btrim(p_email));
  v_person uuid;
begin
  if not (public.is_staff() or public.is_project_member(p_project_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  insert into public.people (email, full_name, source, created_by)
  values (v_email, nullif(btrim(p_full_name), ''), 'teammate_invite', auth.uid())
  on conflict (email) do nothing;

  select id into v_person from public.people where email = v_email;

  insert into public.project_members (project_id, person_id, team_role, created_by)
  values (p_project_id, v_person, coalesce(p_team_role, 'other'), auth.uid())
  on conflict (project_id, person_id) do update set team_role = excluded.team_role;
end $$;

-- Team list for a project: names and roles only (no email/phone/CV).
create or replace function public.project_team(p_project_id uuid)
returns table (person_id uuid, full_name text, team_role text, is_lead boolean, primary_role text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, pm.team_role, pm.is_lead, r.label
  from public.project_members pm
  join public.people p on p.id = pm.person_id
  left join public.roles r on r.id = p.primary_role_id
  where pm.project_id = p_project_id
    and (public.is_staff() or public.is_project_member(p_project_id))
  order by pm.is_lead desc, p.full_name;
$$;

-- Admin CSV import (e.g. Luma guest export). The app parses + previews the
-- CSV, then sends rows as JSON: [{email, full_name?, phone?, external_ref?}, ...]
-- Existing people are never overwritten — only empty fields are filled.
-- Each row runs in its own sub-transaction; one bad row doesn't stop the rest.
create or replace function public.import_participants(p_hackathon_id uuid, p_rows jsonb)
returns table (out_row int, out_email text, out_result text, out_message text)
language plpgsql security definer set search_path = '' as $$
declare
  v_row    jsonb;
  v_i      int := 0;
  v_email  text;
  v_person uuid;
  v_new    boolean;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.hackathons where id = p_hackathon_id) then
    raise exception 'unknown hackathon' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_email := lower(btrim(v_row ->> 'email'));
    begin
      if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        out_row := v_i; out_email := v_email; out_result := 'error'; out_message := 'invalid or missing email';
        return next;
        continue;
      end if;

      insert into public.people (email, full_name, phone, source, created_by)
      values (v_email, nullif(btrim(v_row ->> 'full_name'), ''), nullif(btrim(v_row ->> 'phone'), ''),
              'import', auth.uid())
      on conflict (email) do update
        set full_name = coalesce(public.people.full_name, excluded.full_name),
            phone     = coalesce(public.people.phone, excluded.phone)
      returning id, (xmax = 0) into v_person, v_new;

      insert into public.hackathon_participants (hackathon_id, person_id, source, external_ref, created_by)
      values (p_hackathon_id, v_person, 'import', nullif(btrim(v_row ->> 'external_ref'), ''), auth.uid())
      on conflict (hackathon_id, person_id) do nothing;

      out_row := v_i; out_email := v_email;
      out_result := case when v_new then 'created' else 'existing' end;
      out_message := null;
      return next;
    exception when others then
      out_row := v_i; out_email := v_email; out_result := 'error'; out_message := sqlerrm;
      return next;
    end;
  end loop;
end $$;

revoke execute on function public.add_project_member(uuid, text, text, text) from public, anon;
revoke execute on function public.project_team(uuid)                        from public, anon;
revoke execute on function public.import_participants(uuid, jsonb)          from public, anon;
grant  execute on function public.add_project_member(uuid, text, text, text) to authenticated;
grant  execute on function public.project_team(uuid)                        to authenticated;
grant  execute on function public.import_participants(uuid, jsonb)          to authenticated;

-- =====================================================================
-- 9. Dashboard view: who is registered, signed in, has a project.
--    security_invoker => the caller's RLS applies (staff see everyone).
-- =====================================================================
create view public.hackathon_participant_overview with (security_invoker = true) as
select hp.hackathon_id,
       hp.person_id,
       p.full_name,
       p.email,
       hp.status,
       (p.auth_user_id is not null)                              as has_account,
       (p.primary_role_id is not null and p.headline is not null) as profile_complete,
       exists (select 1 from public.project_members pm
               join public.projects pr on pr.id = pm.project_id
               where pm.person_id = p.id and pr.origin_hackathon_id = hp.hackathon_id) as has_project
from public.hackathon_participants hp
join public.people p on p.id = hp.person_id;

-- =====================================================================
-- 10. Row Level Security
--     anon has no policies anywhere => no anonymous access.
-- =====================================================================
alter table public.user_roles             enable row level security;
alter table public.roles                  enable row level security;
alter table public.people                 enable row level security;
alter table public.hackathons             enable row level security;
alter table public.hackathon_participants enable row level security;
alter table public.projects               enable row level security;
alter table public.project_members        enable row level security;
alter table public.tags                   enable row level security;
alter table public.person_tags            enable row level security;
alter table public.project_tags           enable row level security;
alter table public.profile_documents      enable row level security;

-- user_roles: you can see your own role; only admins manage roles.
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy user_roles_admin on public.user_roles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- roles: readable by everyone signed in; admin-managed.
create policy roles_select on public.roles for select to authenticated using (true);
create policy roles_admin  on public.roles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- people: own row or staff. Participants never see other people's rows
-- (teammates are shown through project_team()). Hard delete = admin, or
-- self via the server-side delete-account route (service role).
create policy people_select on public.people for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select public.is_staff()));
create policy people_insert on public.people for insert to authenticated
  with check ((select public.is_staff())
              or (auth_user_id = (select auth.uid())
                  and email = lower((select auth.jwt()) ->> 'email')
                  and source = 'self'));
create policy people_update on public.people for update to authenticated
  using (auth_user_id = (select auth.uid()) or (select public.is_staff()))
  with check (auth_user_id = (select auth.uid()) or (select public.is_staff()));
create policy people_delete on public.people for delete to authenticated
  using ((select public.is_admin()));

-- hackathons: readable by everyone signed in; admin-managed.
create policy hackathons_select on public.hackathons for select to authenticated using (true);
create policy hackathons_admin  on public.hackathons for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- hackathon_participants: you can join/leave upcoming or active hackathons
-- yourself; staff manage all.
create policy hp_select on public.hackathon_participants for select to authenticated
  using (person_id = (select public.my_person_id()) or (select public.is_staff()));
create policy hp_insert on public.hackathon_participants for insert to authenticated
  with check ((select public.is_staff())
              or (person_id = (select public.my_person_id())
                  and source = 'self'
                  and exists (select 1 from public.hackathons h
                              where h.id = hackathon_id and h.status in ('upcoming', 'active'))));
create policy hp_update on public.hackathon_participants for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy hp_delete on public.hackathon_participants for delete to authenticated
  using (person_id = (select public.my_person_id()) or (select public.is_staff()));

-- projects: members + staff read/edit; any signed-in user can create
-- (creator is auto-added as lead). created_by clause lets insert...returning work.
create policy projects_select on public.projects for select to authenticated
  using ((select public.is_staff()) or public.is_project_member(id)
         or created_by = (select auth.uid()));
create policy projects_insert on public.projects for insert to authenticated
  with check ((select public.is_staff()) or created_by = (select auth.uid()));
create policy projects_update on public.projects for update to authenticated
  using ((select public.is_staff()) or public.is_project_member(id))
  with check ((select public.is_staff()) or public.is_project_member(id));
create policy projects_delete on public.projects for delete to authenticated
  using ((select public.is_admin()));

-- project_members: members see their team's membership rows; adding goes
-- through add_project_member(); members can change roles or remove members.
create policy pm_select on public.project_members for select to authenticated
  using ((select public.is_staff()) or public.is_project_member(project_id));
create policy pm_insert on public.project_members for insert to authenticated
  with check ((select public.is_staff()));
create policy pm_update on public.project_members for update to authenticated
  using ((select public.is_staff()) or public.is_project_member(project_id))
  with check ((select public.is_staff()) or public.is_project_member(project_id));
create policy pm_delete on public.project_members for delete to authenticated
  using ((select public.is_staff()) or public.is_project_member(project_id));

-- tags: see approved tags plus your own suggestions; staff approve/edit.
create policy tags_select on public.tags for select to authenticated
  using (approved or created_by = (select auth.uid()) or (select public.is_staff()));
create policy tags_insert on public.tags for insert to authenticated
  with check (approved = false or (select public.is_staff()));
create policy tags_update on public.tags for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy tags_delete on public.tags for delete to authenticated
  using ((select public.is_staff()));

-- person_tags: your own, or staff.
create policy person_tags_rw on public.person_tags for all to authenticated
  using (person_id = (select public.my_person_id()) or (select public.is_staff()))
  with check (person_id = (select public.my_person_id()) or (select public.is_staff()));

-- project_tags: project members, or staff.
create policy project_tags_rw on public.project_tags for all to authenticated
  using ((select public.is_staff()) or public.is_project_member(project_id))
  with check ((select public.is_staff()) or public.is_project_member(project_id));

-- profile_documents: owner or ADMIN only (staff cannot see CVs).
create policy docs_select on public.profile_documents for select to authenticated
  using (person_id = (select public.my_person_id()) or (select public.is_admin()));
create policy docs_insert on public.profile_documents for insert to authenticated
  with check (person_id = (select public.my_person_id()) or (select public.is_admin()));
create policy docs_delete on public.profile_documents for delete to authenticated
  using (person_id = (select public.my_person_id()) or (select public.is_admin()));

-- =====================================================================
-- 11. Storage: private bucket for CVs / LinkedIn PDFs (max 10 MB, PDF/DOCX)
--     Path: <person_id>/<uuid>-<filename>. Upload with a unique name;
--     there is deliberately no UPDATE policy (no overwrite).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-documents', 'profile-documents', false, 10485760,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy profile_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'profile-documents'
         and ((storage.foldername(name))[1] = (select public.my_person_id())::text
              or (select public.is_admin())));
create policy profile_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-documents'
              and ((storage.foldername(name))[1] = (select public.my_person_id())::text
                   or (select public.is_admin())));
create policy profile_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-documents'
         and ((storage.foldername(name))[1] = (select public.my_person_id())::text
              or (select public.is_admin())));
