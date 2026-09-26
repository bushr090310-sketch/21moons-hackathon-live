import { COSMIC, POWERS, cosmicPhase, deriveStatuses, type CosmicKind, type PowerType, type TeamStatus } from "@/lib/shared/universe";
import { db, iso, withTx, type Tx } from "../db";
import { badRequest, notFound } from "../errors";
import { audit } from "../audit";
import { computeLeaderboard } from "../scoring";
import { eventContext, loadUniverseSettings, publishNews, universeEnvAllowed, type Importance } from "./core";
import { runTick } from "./tick";

export interface FeedItem {
  id: string; type: string; emoji: string; headline: string; body: string | null;
  importance: Importance; source: string; takeover: boolean; points: number | null; createdAt: string;
}

export interface PublicCosmic {
  id: string; phase: "buildup" | "active"; goesLiveAt: string;
  // Only present once the buildup is over — never leak the event early.
  kind?: CosmicKind; emoji?: string; title?: string; explanation?: string; endsAt?: string | null; points?: number | null; challengeTitle?: string | null;
}

export interface UniversePublic {
  enabled: boolean;
  serverTime: string;
  feed: FeedItem[];
  takeovers: FeedItem[];
  statuses: Record<string, TeamStatus>;
  cosmic: PublicCosmic | null;
  eclipse: boolean;
}

const OFF = (): UniversePublic => ({ enabled: false, serverTime: new Date().toISOString(), feed: [], takeovers: [], statuses: {}, cosmic: null, eclipse: false });

async function computeStatuses(tx: Tx, cutoff: string | null, now: number, oneToWatch: string | null) {
  const ref = cutoff ? new Date(cutoff) : new Date(now);
  const board = await computeLeaderboard(tx, cutoff);
  const past = await computeLeaderboard(tx, new Date(ref.getTime() - 30 * 60_000));
  const pastRank = new Map(past.map((r) => [r.teamId, r.rank]));
  const gained = await tx`
    select team_id, sum(points_delta)::int as g, max(created_at) filter (where points_delta > 0) as last_pos from score_ledger
    where created_at <= ${ref} group by team_id`;
  const hour = await tx`
    select team_id, sum(points_delta)::int as g from score_ledger
    where created_at <= ${ref} and created_at > ${new Date(ref.getTime() - 3600_000)} group by team_id`;
  const hourMap = new Map(hour.map((h) => [h.team_id as string, h.g as number]));
  const lastMap = new Map(gained.map((h) => [h.team_id as string, iso(h.last_pos)]));
  return deriveStatuses(board.map((r) => ({
    teamId: r.teamId, rank: r.rank, score: r.score, gainedLastHour: hourMap.get(r.teamId) ?? 0,
    rankThirtyMinAgo: pastRank.get(r.teamId) ?? null, lastScoredAt: lastMap.get(r.teamId) ?? null,
  })), ref.getTime(), oneToWatch);
}

function mapFeed(rows: Record<string, unknown>[], hidePoints: boolean): FeedItem[] {
  return rows.map((r) => ({
    id: String(r.id), type: r.event_type as string, emoji: r.emoji as string, headline: r.headline as string,
    body: hidePoints && r.points_delta != null ? null : ((r.body as string) ?? null),
    importance: r.importance as Importance, source: r.source as string, takeover: !!r.takeover,
    points: hidePoints ? null : r.points_delta == null ? null : Number(r.points_delta), createdAt: iso(r.created_at)!,
  }));
}

let cache: { at: number; value: UniversePublic } | null = null;

/** Public universe payload. Never throws — returns an "off" payload on any failure. */
export async function getUniversePublic({ fresh = false } = {}): Promise<UniversePublic> {
  try {
    if (!universeEnvAllowed()) return OFF();
    if (!fresh && cache && Date.now() - cache.at < 2000) return cache.value;
    const settings = await loadUniverseSettings();
    if (!settings.enabled) return OFF();
    await runTick().catch((e) => console.error("[universe tick]", e));
    const value = await db().begin("isolation level repeatable read read only", async (tx) => {
      const ctx = await eventContext(tx);
      const cutoff = ctx.frozen ? ctx.frozenAt : null;
      const [live] = await tx`select * from chaos_events where status = 'live' limit 1`;
      const phase = cosmicPhase(live ? { status: live.status, goesLiveAt: iso(live.goes_live_at), endsAt: iso(live.ends_at) } : null, ctx.now);
      const eclipse = phase === "active" && live.kind === "ECLIPSE";
      // While frozen: only items from before the freeze plus organizer broadcasts (no score leaks).
      const rows = await tx`
        select * from live_events
        where published and archived_at is null and (expires_at is null or expires_at > now())
          and (${cutoff}::timestamptz is null or created_at <= ${cutoff}::timestamptz or source = 'admin')
        order by created_at desc, id desc limit 10`;
      const feed = mapFeed(rows, eclipse);
      const takeovers = feed.filter((f) => f.takeover && ctx.now - new Date(f.createdAt).getTime() <= 120_000);
      let cosmic: PublicCosmic | null = null;
      if (live && (phase === "buildup" || phase === "active")) {
        cosmic = phase === "buildup"
          ? { id: live.id, phase, goesLiveAt: iso(live.goes_live_at)! }
          : {
              id: live.id, phase, goesLiveAt: iso(live.goes_live_at)!, kind: live.kind, emoji: COSMIC[live.kind as CosmicKind]?.emoji ?? "🌌",
              title: live.title, explanation: live.explanation, endsAt: iso(live.ends_at), points: live.points ?? null,
              challengeTitle: (live.metadata?.challengeTitle as string) ?? null,
            };
      }
      const statuses = await computeStatuses(tx, cutoff, ctx.now, settings.oneToWatchTeamId);
      return { enabled: true, serverTime: new Date(ctx.now).toISOString(), feed, takeovers, statuses, cosmic, eclipse } satisfies UniversePublic;
    });
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    console.error("[universe public]", (e as Error).message);
    return OFF();
  }
}

export function invalidateUniverseCache() { cache = null; }

// ---------------------------------------------------------------------------
// Team view (powers)
// ---------------------------------------------------------------------------
export async function getUniverseTeam(teamId: string) {
  if (!universeEnvAllowed()) return { enabled: false as const };
  const settings = await loadUniverseSettings();
  if (!settings.enabled) return { enabled: false as const };
  await runTick().catch(() => {});
  const ctx = await eventContext();
  const powers = await db()`
    select id, powerup_type, status, earned_at from team_powerups where team_id = ${teamId} and status = 'available' order by earned_at`;
  const board = await computeLeaderboard(db(), ctx.frozen ? ctx.frozenAt : null);
  return {
    enabled: true as const,
    frozen: ctx.frozen,
    powers: powers.map((p) => ({ id: p.id as string, type: p.powerup_type as PowerType })),
    targets: board.filter((r) => r.teamId !== teamId).map((r) => ({ teamId: r.teamId, name: r.name, score: r.score, rank: r.rank })),
  };
}

// ---------------------------------------------------------------------------
// Admin: LIVE UNIVERSE control room
// ---------------------------------------------------------------------------
export async function getUniverseAdmin() {
  const envAllowed = universeEnvAllowed();
  const settings = await loadUniverseSettings();
  if (envAllowed && settings.enabled) await runTick().catch(() => {});
  const pub = envAllowed && settings.enabled ? await getUniversePublic({ fresh: true }) : null;
  const sql = db();
  const ctx = await eventContext();
  const news = await sql`select * from live_events order by created_at desc, id desc limit 60`;
  const powers = await sql`
    select p.id, p.team_id, t.name as team, p.powerup_type, p.status, p.source, p.earned_at, p.used_at, c.title as challenge
    from team_powerups p join teams t on t.id = p.team_id left join challenges c on c.id = p.earned_from_challenge_id
    order by p.earned_at desc limit 300`;
  const attacks = await sql`
    select a.*, ta.name as attacker, tt.name as target from power_attacks a
    join teams ta on ta.id = a.attacker_team_id join teams tt on tt.id = a.target_team_id
    order by a.created_at desc limit 100`;
  const rewards = await sql`
    select r.challenge_id, r.powerup_type, r.created_at, c.title, c.emoji, c.status from challenge_power_rewards r join challenges c on c.id = r.challenge_id order by c.sort_order`;
  const events = await sql`select * from chaos_events where status <> 'cancelled' or updated_at > now() - interval '2 hours' order by created_at desc limit 40`;
  const teams = await sql`select id, name from teams where active order by lower(name)`;
  const challenges = await sql`select id, title, emoji, status from challenges where status <> 'archived' order by sort_order, title`;
  const board = await computeLeaderboard(sql, null);
  const liveStatuses = await computeStatuses(sql, null, ctx.now, settings.oneToWatchTeamId);
  return {
    serverTime: new Date(ctx.now).toISOString(),
    envAllowed,
    settings,
    frozen: ctx.frozen,
    public: pub,
    news: news.map((n) => ({ ...mapFeed([n], false)[0], archived: !!n.archived_at, teamId: n.team_id as string | null })),
    statuses: board.map((r) => ({ teamId: r.teamId, name: r.name, rank: r.rank, score: r.score, status: liveStatuses[r.teamId] ?? null })),
    powers: powers.map((p) => ({ id: p.id as string, teamId: p.team_id as string, team: p.team as string, type: p.powerup_type as PowerType, status: p.status as string, source: p.source as string, challenge: (p.challenge as string) ?? null, earnedAt: iso(p.earned_at)!, usedAt: iso(p.used_at) })),
    attacks: attacks.map((a) => ({ id: a.id as string, attacker: a.attacker as string, target: a.target as string, type: a.powerup_type as PowerType, applied: a.applied_delta as number, requested: a.requested_delta as number, blocked: !!a.blocked, ledgerId: a.ledger_id == null ? null : Number(a.ledger_id), at: iso(a.created_at)! })),
    rewards: rewards.map((r) => ({ challengeId: r.challenge_id as string, type: r.powerup_type as PowerType, title: r.title as string, emoji: r.emoji as string, status: r.status as string, since: iso(r.created_at)! })),
    events: events.map((e) => ({
      id: e.id as string, kind: e.kind as CosmicKind, status: e.status as string, title: e.title as string, explanation: e.explanation as string,
      reason: (e.reason as string) ?? null, buildupSeconds: e.buildup_seconds as number, durationMinutes: (e.duration_minutes as number) ?? null,
      points: (e.points as number) ?? null, linkedChallengeId: (e.linked_challenge_id as string) ?? null, goesLiveAt: iso(e.goes_live_at), endsAt: iso(e.ends_at), createdAt: iso(e.created_at)!,
      phase: cosmicPhase({ status: e.status, goesLiveAt: iso(e.goes_live_at), endsAt: iso(e.ends_at) }, ctx.now),
    })),
    teams: teams.map((t) => ({ id: t.id as string, name: t.name as string })),
    challenges: challenges.map((c) => ({ id: c.id as string, title: c.title as string, emoji: c.emoji as string, status: c.status as string })),
    powerCatalog: POWERS,
  };
}
export type UniverseAdminState = Awaited<ReturnType<typeof getUniverseAdmin>>;

export async function publishBroadcast(input: { headline: string; body?: string | null; importance: Importance; teamId?: string | null; emoji?: string }) {
  const headline = input.headline.trim();
  if (headline.length < 2) throw badRequest("Headline is required");
  return withTx(async (tx) => {
    if (input.teamId) {
      const [t] = await tx`select 1 from teams where id = ${input.teamId}`;
      if (!t) throw notFound("Team not found");
    }
    const id = await publishNews(tx, {
      type: "BROADCAST", emoji: input.emoji?.trim() || "📡", headline: headline.toUpperCase(), body: input.body?.trim() || null,
      importance: input.importance, source: "admin", takeover: input.importance !== "normal", teamId: input.teamId ?? null,
    });
    await audit(tx, "universe.news_published", { id, headline, importance: input.importance });
    return { id };
  });
}

/** Hide a news item. Touches only live_events — never competition data. */
export async function archiveNews(id: number) {
  return withTx(async (tx) => {
    const r = await tx`update live_events set archived_at = now() where id = ${id} and archived_at is null returning headline, source`;
    if (!r.length) throw notFound("News item not found");
    await audit(tx, "universe.news_archived", { id, headline: r[0].headline, source: r[0].source });
  });
}

export async function updateUniverseSettings(p: { enabled?: boolean; autoNews?: boolean; oneToWatchTeamId?: string | null }) {
  return withTx(async (tx) => {
    await tx`
      update universe_settings set
        enabled = coalesce(${p.enabled ?? null}::boolean, enabled),
        auto_news = coalesce(${p.autoNews ?? null}::boolean, auto_news),
        one_to_watch_team_id = case when ${p.oneToWatchTeamId !== undefined} then ${p.oneToWatchTeamId ?? null}::uuid else one_to_watch_team_id end,
        updated_at = now()
      where id = 1`;
    if (p.enabled === true) {
      // Re-baseline so switching on mid-event never floods the feed with history.
      await tx`update universe_state set snapshot = null, last_ledger_id = null where id = 1`;
    }
    await audit(tx, "universe.settings", p as Record<string, unknown>);
  });
}
