#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order, exactly once each, inside a transaction.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { resolveDatabaseUrl, connectionOptions } from "./db-url.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "supabase", "migrations");

export async function migrate(databaseUrl, { log = console.log } = {}) {
  const opts = connectionOptions(databaseUrl);
  const sql = postgres(opts.url, { ssl: opts.ssl, prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(21212121)`;
        const done = await tx`select 1 from schema_migrations where name = ${file}`;
        if (done.length) return;
        log(`applying ${file}`);
        await tx.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
        await tx`insert into schema_migrations (name) values (${file})`;
      });
    }
    log("migrations up to date");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const ifConfigured = process.argv.includes("--if-configured");
  const url = resolveDatabaseUrl({ preferDirect: true });
  if (!url) {
    if (ifConfigured) {
      console.log("No DATABASE_URL/POSTGRES_URL set — skipping migrations.");
      process.exit(0);
    }
    console.error("DATABASE_URL (or POSTGRES_URL) is required");
    process.exit(1);
  }
  migrate(url).catch(async (err) => {
    // Direct connections may be IPv6-only; retry through the pooler.
    const pooled = resolveDatabaseUrl();
    if (pooled && pooled !== url) {
      console.warn("Direct migration failed (" + err.message + "), retrying via pooled URL");
      try { await migrate(pooled); return; } catch (e) { err = e; }
    }
    console.error(err);
    process.exit(1);
  });
}
