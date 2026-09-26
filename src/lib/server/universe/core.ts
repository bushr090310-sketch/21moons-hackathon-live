// Shared helpers for the 21MOONS UNIVERSE layer. Everything here is additive.
import { db, iso, type Tx } from "../db";
import { AppError } from "../errors";

/**
 * Environment kill switches. Preview deployments share production env vars, so the
 * universe layer is OFF there unless explicitly allowed.
 */
export function universeEnvAllowed(): boolean {
  if (process.env.UNIVERSE_DISABLED === "1") return false;
  if (process.env.VERCEL_ENV === "preview" && process.env.UNIVERSE_ALLOW_PREVIEW !== "1") return false;
  return true;
}

export interface UniverseSettings { enabled: boolean; autoNews: boolean; oneToWatchTeamId: string | null }

export async function loadUniverseSettings(tx: Tx = db()): Promise<UniverseSettings> {
  const [s] = await tx`select enabled, auto_news, one_to_watch_team_id from universe_settings where id = 1`;
  return { enabled: !!s?.enabled, autoNews: s?.auto_news !== false, oneToWatchTeamId: s?.one_to_watch_team_id ?? null };
}

export async function isUniverseLive(tx: Tx = db()): Promise<boolean> {
  if (!universeEnvAllowed()) return false;
  return (await loadUniverseSettings(tx)).enabled;
}

export async function requireUniverseLive(tx: Tx = db()) {
  if (!(await isUniverseLive(tx))) throw new AppError(409, "The 21MOONS Universe is currently switched off.");
}

/** Read-only view of the existing event settings the universe needs. */
export async function eventContext(tx: Tx = db()) {
  const [s] = await tx`select leaderboard_frozen, frozen_at, event_starts_at, event_ends_at, now() as now from event_settings where id = 1`;
  return {
    frozen: !!s?.leaderboard_frozen,
    frozenAt: iso(s?.frozen_at),
    startsAt: iso(s?.event_starts_at),
    endsAt: iso(s?.event_ends_at),
    now: new Date(s?.now ?? Date.now()).getTime(),
  };
}

export type Importance = "normal" | "hot" | "breaking";

export interface NewsInput {
  type: string;
  emoji: string;
  headline: string;
  body?: string | null;
  teamId?: string | null;
  targetTeamId?: string | null;
  pointsDelta?: number | null;
  importance?: Importance;
  source?: "system" | "admin";
  takeover?: boolean;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
}

/** Insert a Lunar Network item. Returns null when deduplicated. */
export async function publishNews(tx: Tx, n: NewsInput): Promise<number | null> {
  const rows = await tx`
    insert into live_events (event_type, emoji, headline, body, team_id, target_team_id, points_delta, importance, source,
                             takeover, dedupe_key, metadata, expires_at)
    values (${n.type}, ${n.emoji}, ${n.headline.slice(0, 140)}, ${n.body?.slice(0, 400) ?? null}, ${n.teamId ?? null},
            ${n.targetTeamId ?? null}, ${n.pointsDelta ?? null}, ${n.importance ?? "normal"}, ${n.source ?? "system"},
            ${!!n.takeover}, ${n.dedupeKey ?? null}, ${tx.json((n.metadata ?? {}) as never)}, ${n.expiresAt ?? null})
    on conflict (dedupe_key) do nothing
    returning id`;
  return rows.length ? Number(rows[0].id) : null;
}
