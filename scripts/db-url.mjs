// Shared connection helper for scripts and the app.
// Accepts DATABASE_URL or the variables injected by the Vercel <> Supabase integration.
export function resolveDatabaseUrl({ preferDirect = false } = {}) {
  const pooled = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  return preferDirect ? direct || pooled : pooled || direct;
}

// Strip query params postgres.js would forward as server options (e.g. `supa=...`, `sslmode`)
// and derive explicit options instead.
export function connectionOptions(url) {
  const u = new URL(url);
  const sslmode = u.searchParams.get("sslmode");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(u.hostname) || u.hostname.endsWith(".local");
  const ssl = sslmode === "disable" || (isLocal && !sslmode) ? false : "require";
  const pooler = u.port === "6543" || u.hostname.includes("pooler");
  u.search = "";
  return { url: u.toString(), ssl, prepare: !pooler };
}
