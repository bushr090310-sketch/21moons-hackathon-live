import postgres from "postgres";
import { AppError } from "./errors";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql | postgres.Sql;

declare global {
  var __moonsSql: Sql | undefined;
}

export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
}

export function connectionOptions(url: string) {
  const u = new URL(url);
  const sslmode = u.searchParams.get("sslmode");
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  const ssl: false | "require" = sslmode === "disable" || (isLocal && !sslmode) ? false : "require";
  const pooler = u.port === "6543" || u.hostname.includes("pooler");
  u.search = "";
  return { url: u.toString(), ssl, prepare: !pooler };
}

export function db(): Sql {
  if (!globalThis.__moonsSql) {
    const url = databaseUrl();
    if (!url) throw new AppError(503, "Database is not configured. Set DATABASE_URL.");
    const o = connectionOptions(url);
    globalThis.__moonsSql = postgres(o.url, {
      ssl: o.ssl,
      prepare: o.prepare,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return globalThis.__moonsSql;
}

export async function withTx<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return (await db().begin(fn)) as T;
}

export const num = (v: unknown): number | null => (v == null ? null : Number(v));
export const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
