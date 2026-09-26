// Deterministic generator for Lunar Network news and Cosmic Event suggestions.
// Runs opportunistically (at most every ~12 s) when screens poll. No cron needed.
// Reads existing competition data; writes ONLY to universe tables.
import { db, type Tx } from "../db";
import { computeLeaderboard } from "../scoring";
import { eventContext, loadUniverseSettings, publishNews, universeEnvAllowed, type NewsInput } from "./core";
import { reconcileRewards } from "./powers";
import { cosmicLifecycle, suggestEvent } from "./cosmic";

export const NEWS_RULES = {
  maxSystemPer5Min: 6,
  closeRaceGap: 5,
  closeRaceCooldownMin: 20,
  surgePts: 40,
  surgeCooldownMin: 45,
  quietMinutes: 25,
  maxOvertakesPerTick: 2,
  huntLeaderGap: 30,
};

const SALE_SLUGS = ["first-sale", "revenue-rush"];
const CONTENT_RE = /(content|social|viral|posts)/i;

interface Snap { leader: string | null; order: { id: string; name: string; score: number; rank: number }[] }

async function capReached(tx: Tx) {
  const [{ n }] = await tx`select count(*)::int as n from live_events where source = 'system' and created_at > now() - interval '5 minutes'`;
  return n >= NEWS_RULES.maxSystemPer5Min;
}

async function sys(tx: Tx, n: NewsInput) {
  if (await capReached(tx)) return null;
  return publishNews(tx, { ...n, source: "system" });
}

async function recentOfType(tx: Tx, type: string, minutes: number, teamId?: string) {
  const [r] = await tx`
    select 1 from live_events where event_type = ${type} and created_at > now() - make_interval(mins => ${minutes})
      and (${teamId ?? null}::uuid is null or team_id = ${teamId ?? null}::uuid) limit 1`;
  return !!r;
}

export async function competitionNews(tx: Tx) {
  const ctx = await eventContext(tx);
  const [{ max_id }] = await tx`select coalesce(max(id), 0)::bigint as max_id from score_ledger`;
  const [st] = await tx`select snapshot, last_ledger_id from universe_state where id = 1 for update`;

  // While frozen, nothing score-related is announced; re-baseline after the reveal (no flood).
  if (ctx.frozen) {
    await tx`update universe_state set snapshot = null, last_ledger_id = ${max_id}, updated_at = now() where id = 1`;
    return;
  }
  const board = await computeLeaderboard(tx, null);
  const snap: Snap = { leader: board[0] && board[0].score > 0 ? board[0].teamId : null, order: board.map((r) => ({ id: r.teamId, name: r.name, score: r.score, rank: r.rank })) };
  const prev = st?.snapshot as Snap | null;
  const lastId = st?.last_ledger_id == null ? null : Number(st.last_ledger_id);

  if (!prev || lastId == null) {
    // First run (e.g. switched on mid-event): baseline only, never announce history.
    await tx`update universe_state set snapshot = ${tx.json(snap as never)}, last_ledger_id = ${max_id}, updated_at = now() where id = 1`;
    return;
  }

  // 1) New ledger entries → signals & claims (attack entries are announced at attack time)
  const fresh = await tx`
    select l.id, l.team_id, l.points_delta, l.entry_type, t.name as team, c.id as challenge_id, c.slug, c.title, c.challenge_type
    from score_ledger l join teams t on t.id = l.team_id and t.active left join challenges c on c.id = l.challenge_id
    where l.id > ${lastId} and l.points_delta > 0 and l.entry_type in ('challenge_award','final_award')
    order by l.id limit 200`;
  for (const e of fresh) {
    if (e.slug && SALE_SLUGS.includes(e.slug)) {
      await sys(tx, { type: "SIGNAL", emoji: "💰", importance: "hot", teamId: e.team_id, pointsDelta: Number(e.points_delta),
        headline: `SIGNAL RECEIVED — ${e.team.toUpperCase()} JUST LANDED A REAL CUSTOMER`, dedupeKey: `signal:${e.id}` });
    } else if (e.challenge_type === "FIRST_GLOBAL") {
      await sys(tx, { type: "CLAIM", emoji: "🏁", importance: "hot", teamId: e.team_id, pointsDelta: Number(e.points_delta),
        headline: `${e.team.toUpperCase()} CLAIMED ${String(e.title).toUpperCase()}`, body: `First team to do it · +${e.points_delta} pts`, dedupeKey: `claim:${e.challenge_id}` });
    }
  }

  // 2) Leader change
  const leader = board[0];
  if (snap.leader && snap.leader !== prev.leader && leader) {
    await sys(tx, { type: "NEW_LEADER", emoji: "🌕", importance: "breaking", takeover: true, teamId: leader.teamId, pointsDelta: leader.score,
      headline: `FULL MOON — ${leader.name.toUpperCase()} HAVE TAKEN THE LEAD`, body: `${leader.score} pts`, dedupeKey: `leader:${leader.teamId}:${leader.score}` });
  }

  // 3) Overtakes in the top 5 (excluding the new leader, already announced)
  const prevRank = new Map(prev.order.map((o) => [o.id, o.rank]));
  let overtakes = 0;
  for (const a of board.slice(0, 5)) {
    if (overtakes >= NEWS_RULES.maxOvertakesPerTick) break;
    if (a.rank === 1 && snap.leader !== prev.leader) continue;
    const pa = prevRank.get(a.teamId);
    if (pa == null || pa <= a.rank || a.score <= 0) continue;
    const passed = board.find((b) => b.rank === a.rank + 1 && (prevRank.get(b.teamId) ?? 999) < pa);
    if (!passed) continue;
    const id = await sys(tx, { type: "OVERTAKE", emoji: "🚀", importance: "hot", teamId: a.teamId, targetTeamId: passed.teamId,
      headline: `ORBIT OVERTAKE — ${a.name.toUpperCase()} JUST PASSED ${passed.name.toUpperCase()}`, body: `Now #${a.rank} with ${a.score} pts`,
      dedupeKey: `overtake:${a.teamId}:${passed.teamId}:${a.score}` });
    if (id) overtakes++;
  }

  // 4) Close race at the top
  if (board.length >= 2 && board[0].score > 0 && board[1].score > 0) {
    const gap = board[0].score - board[1].score;
    if (gap <= NEWS_RULES.closeRaceGap && !(await recentOfType(tx, "CLOSE_RACE", NEWS_RULES.closeRaceCooldownMin))) {
      await sys(tx, { type: "CLOSE_RACE", emoji: "👀", importance: "hot",
        headline: gap === 0 ? "ORBIT BATTLE — THE TOP TWO MOONS ARE LEVEL" : `ORBIT BATTLE — ONLY ${gap} PTS SEPARATE THE TOP TWO MOONS`,
        body: `${board[0].name} vs ${board[1].name}`, dedupeKey: `close:${board[0].teamId}:${board[1].teamId}:${board[0].score}:${board[1].score}` });
    }
  }

  // 5) Supernova surges (pts gained in the last hour)
  const surges = await tx`
    select l.team_id, t.name, sum(l.points_delta)::int as gained from score_ledger l join teams t on t.id = l.team_id and t.active
    where l.created_at > now() - interval '60 minutes' group by l.team_id, t.name having sum(l.points_delta) >= ${NEWS_RULES.surgePts}`;
  for (const s of surges) {
    if (await recentOfType(tx, "SURGE", NEWS_RULES.surgeCooldownMin, s.team_id)) continue;
    await sys(tx, { type: "SURGE", emoji: "☀️", importance: "hot", takeover: true, teamId: s.team_id, pointsDelta: s.gained,
      headline: `SUPERNOVA — ${s.name.toUpperCase()} JUST GAINED ${s.gained} PTS`, body: "in the last hour",
      dedupeKey: `surge:${s.team_id}:${Math.floor(ctx.now / (NEWS_RULES.surgeCooldownMin * 60_000))}` });
  }

  // 6) Quiet galaxy
  const running = ctx.startsAt && ctx.endsAt && ctx.now > new Date(ctx.startsAt).getTime() && ctx.now < new Date(ctx.endsAt).getTime();
  const [lastPos] = await tx`select id, created_at from score_ledger where points_delta > 0 order by id desc limit 1`;
  if (running && lastPos && ctx.now - new Date(lastPos.created_at).getTime() >= NEWS_RULES.quietMinutes * 60_000) {
    await sys(tx, { type: "QUIET", emoji: "🌑", headline: "THE GALAXY IS QUIET...", body: `No score movement for ${NEWS_RULES.quietMinutes} minutes`, dedupeKey: `quiet:${lastPos.id}` });
  }

  // 7) Halftime galactic report (once, within an hour after the midpoint)
  if (ctx.startsAt && ctx.endsAt) {
    const mid = (new Date(ctx.startsAt).getTime() + new Date(ctx.endsAt).getTime()) / 2;
    if (ctx.now >= mid && ctx.now < mid + 3600_000) {
      const [r] = await tx`
        select (select count(*)::int from teams where active) as moons,
               (select coalesce(sum(points_delta), 0)::int from score_ledger l join teams t on t.id = l.team_id and t.active) as pts,
               (select count(*)::int from challenge_submissions s join teams t on t.id = s.team_id and t.active where s.status = 'approved') as done`;
      await sys(tx, { type: "REPORT", emoji: "🌙", importance: "hot", headline: "GALACTIC REPORT — HALFTIME",
        body: `${r.moons} Moons · ${r.pts} pts awarded · ${r.done} challenges completed`, dedupeKey: "report:halftime" });
    }
  }

  await tx`update universe_state set snapshot = ${tx.json(snap as never)}, last_ledger_id = ${max_id}, updated_at = now() where id = 1`;
}

/** Deterministic suggestions. NEVER activates anything. */
export async function suggestCosmicEvents(tx: Tx) {
  const [live] = await tx`select 1 from chaos_events where status = 'live' limit 1`;
  if (live) return;
  const ctx = await eventContext(tx);
  if (ctx.frozen) return;
  const hour = Math.floor(ctx.now / 3600_000);
  const board = await computeLeaderboard(tx, null);
  if (board.length >= 2 && board[0].score - board[1].score > NEWS_RULES.huntLeaderGap) {
    await suggestEvent(tx, "HUNT_THE_LEADER", `${board[0].name} leads by ${board[0].score - board[1].score} pts`, `hunt:${board[0].teamId}:${hour}`);
  }
  if (board.length >= 2 && board[0].score >= 20 && board[1].score >= 20 && board[0].score - board[1].score <= NEWS_RULES.closeRaceGap) {
    await suggestEvent(tx, "BLACK_HOLE", `Only ${board[0].score - board[1].score} pts between #1 and #2`, `blackhole:${hour}`);
  }
  const running = ctx.startsAt && ctx.now > new Date(ctx.startsAt).getTime() + 3600_000 && (!ctx.endsAt || ctx.now < new Date(ctx.endsAt).getTime());
  if (!running) return;
  const [lastPos] = await tx`select id, created_at from score_ledger where points_delta > 0 order by id desc limit 1`;
  if (lastPos && ctx.now - new Date(lastPos.created_at).getTime() >= NEWS_RULES.quietMinutes * 60_000) {
    await suggestEvent(tx, "SOLAR_FLARE", `No score movement for ${NEWS_RULES.quietMinutes}+ minutes`, `flare:${lastPos.id}`);
  }
  const content = await tx`select id, slug from challenges where status in ('scheduled','live','locked')`;
  const contentIds = content.filter((c) => CONTENT_RE.test(c.slug)).map((c) => c.id as string);
  if (contentIds.length) {
    const [{ n }] = await tx`
      select count(*)::int as n from challenge_submissions
      where challenge_id = any(${contentIds}::uuid[]) and submitted_at > now() - interval '60 minutes'`;
    if (n === 0) await suggestEvent(tx, "CONTENT_STORM", "No content/social submissions in the last hour", `content:${hour}`);
  }
}

/**
 * Run one tick if due. Each step is isolated: a failure in one never blocks the
 * others, and never propagates to the caller (the existing app keeps working).
 */
export async function runTick({ force = false } = {}): Promise<{ ran: boolean; errors: string[] }> {
  const errors: string[] = [];
  if (!universeEnvAllowed()) return { ran: false, errors };
  const settings = await loadUniverseSettings();
  if (!settings.enabled) return { ran: false, errors };
  const claimed = force
    ? await db()`update universe_state set last_tick_at = now() where id = 1 returning id`
    : await db()`update universe_state set last_tick_at = now() where id = 1 and last_tick_at < now() - interval '12 seconds' returning id`;
  if (!claimed.length) return { ran: false, errors };
  const steps: [string, (tx: Tx) => Promise<unknown>][] = [
    ["rewards", reconcileRewards],
    ["cosmic", cosmicLifecycle],
    ...(settings.autoNews ? [["news", competitionNews] as [string, (tx: Tx) => Promise<unknown>]] : []),
    ["suggestions", suggestCosmicEvents],
  ];
  for (const [name, fn] of steps) {
    try {
      await db().begin((tx) => fn(tx));
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
      console.error("[universe tick]", name, e);
    }
  }
  return { ran: true, errors };
}
