import { db } from "./db";
import { AppError } from "./errors";

/** DB-backed failure throttle (works across serverless instances). */
export async function assertNotThrottled(kind: string, key: string, maxFailures: number, windowMinutes = 10) {
  const [row] = await db()`
    select count(*)::int as n from auth_attempts
    where kind = ${kind} and key = ${key} and created_at > now() - make_interval(mins => ${windowMinutes})`;
  if (row.n >= maxFailures) {
    throw new AppError(429, `Too many failed attempts. Wait ${windowMinutes} minutes or ask an organizer.`);
  }
}

export async function recordFailure(kind: string, key: string) {
  await db()`insert into auth_attempts (kind, key) values (${kind}, ${key})`;
  if (Math.random() < 0.05) await db()`delete from auth_attempts where created_at < now() - interval '1 day'`;
}
