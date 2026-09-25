import { execSync } from "node:child_process";
import postgres from "postgres";
// @ts-expect-error — plain JS module
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
  await pre.end();
  await migrate(testDb, { log: () => {} });
}
