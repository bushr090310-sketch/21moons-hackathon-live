import { execSync } from "node:child_process";
import postgres from "postgres";
import { migrate } from "../scripts/migrate.mjs";

export default async function setup() {
  const base = execSync("bash scripts/local-db.sh", { encoding: "utf8" }).trim();
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  await admin.unsafe("drop database if exists moons_test with (force)");
  await admin.unsafe("create database moons_test");
  // Mirror Supabase's API roles so RLS/grant behaviour is tested for real.
  await admin.unsafe(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;`);
  await admin.end();
  const testDb = base.replace(/\/postgres$/, "/moons_test");
  const pre = postgres(testDb, { max: 1, onnotice: () => {} });
  // Supabase grants the API roles broad default privileges; emulate that so the migration's revokes matter.
  await pre.unsafe("grant usage on schema public to anon, authenticated; alter default privileges in schema public grant all on tables to anon, authenticated;");
  // Minimal stand-ins for the Supabase-managed schemas the CRM migration depends on
  // (auth.users/uid()/jwt(), storage.buckets/objects/foldername(), the extensions schema).
  await pre.unsafe(SUPABASE_STUBS);
  await pre.end();
  await migrate(testDb, { log: () => {} });
}

const SUPABASE_STUBS = `
create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'
);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema auth, storage, extensions to anon, authenticated;
grant all on storage.objects to authenticated;
`;
