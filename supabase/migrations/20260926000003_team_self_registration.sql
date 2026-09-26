-- Self-service team registration.
alter table event_settings add column if not exists team_registration_open boolean not null default true;
alter table teams add column if not exists self_registered boolean not null default false;

-- Team names are unique among active teams (case-insensitive), enforced by the
-- database so two simultaneous registrations can't both win.
create unique index if not exists teams_active_name_unique on teams (lower(name)) where active;

-- Keep the Data API locked down for the new columns (table-level revokes already apply).
