import type { ActivityItem, LeaderboardRow } from "@/lib/shared/types";
import { iso, type Tx } from "./db";
import { badRequest, conflict, notFound } from "./errors";
import { audit } from "./audit";

export type LedgerType = "challenge_award" | "final_award" | "vote_award" | "manual_adjustment" | "reversal";

export interface LedgerInput {
  teamId: string;
  challengeId?: string | null;
  submissionId?: string | null;
  delta: number;
  type: LedgerType;
  reason: string;
  publicLabel: string;
  awardKey?: string | null;
  reversesId?: number | null;
}

/** The ONLY way points change. Append-only; a DB trigger updates teams.score_cached. */
export async function insertLedger(tx: Tx, e: LedgerInput) {
  if (!Number.isInteger(e.delta) || e.delta === 0) throw badRequest("Points must be a non-zero whole number");
  const [row] = await tx`
    insert into score_ledger (team_id, challenge_id, submission_id, points_delta, entry_type, reason, public_label, award_key, reverses_id)
    values (${e.teamId}, ${e.challengeId ?? null}, ${e.submissionId ?? null}, ${e.delta}, ${e.type},
            ${e.reason.slice(0, 500)}, ${e.publicLabel.slice(0, 120)}, ${e.awardKey ?? null}, ${e.reversesId ?? null})
    returning id, created_at`;
  return { id: Number(row.id), createdAt: iso(row.created_at)! };
}

/**
 * Leaderboard computed straight from the ledger. `cutoff` (the freeze time) makes the
 * public board show exactly the state at freeze time while real points keep accruing.
 * Ties: equal points keep equal score; visual order = who reached that score first, then name.
 */
export async function computeLeaderboard(tx: Tx, cutoff: Date | string | null): Promise<LeaderboardRow[]> {
  const c = cutoff ? new Date(cutoff) : null;
  const rows = await tx`
    with l as (
      select * from score_ledger where ${c}::timestamptz is null or created_at <= ${c}::timestamptz
    ),
    agg as (
      select team_id, sum(points_delta)::int as score, max(created_at) as reached_at from l group by team_id
    ),
    last as (
      select distinct on (team_id) team_id, points_delta, created_at, public_label
      from l order by team_id, created_at desc, id desc
    ),
    comp as (
      select team_id, count(*)::int as n from (
        select team_id, challenge_id from l where challenge_id is not null
        group by team_id, challenge_id having sum(points_delta) > 0
      ) x group by team_id
    )
    select t.id, t.name, coalesce(a.score, 0)::int as score, a.reached_at,
           last.points_delta as last_delta, last.created_at as last_at, last.public_label as last_label,
           coalesce(comp.n, 0)::int as completed
    from teams t
    left join agg a on a.team_id = t.id
    left join last on last.team_id = t.id
    left join comp on comp.team_id = t.id
    where t.active
    order by score desc, a.reached_at asc nulls last, lower(t.name) asc, t.id asc`;
  return rows.map((r, i) => ({
    teamId: r.id,
    name: r.name,
    score: r.score,
    rank: i + 1,
    reachedAt: iso(r.reached_at),
    lastDelta: r.last_delta == null ? null : Number(r.last_delta),
    lastDeltaAt: iso(r.last_at),
    lastLabel: r.last_label ?? null,
    completed: r.completed,
  }));
}

export async function recentActivity(tx: Tx, cutoff: Date | string | null, limit = 20): Promise<ActivityItem[]> {
  const c = cutoff ? new Date(cutoff) : null;
  const rows = await tx`
    select l.id, l.points_delta, l.public_label, l.created_at, t.name as team_name, ch.emoji
    from score_ledger l
    join teams t on t.id = l.team_id and t.active
    left join challenges ch on ch.id = l.challenge_id
    where ${c}::timestamptz is null or l.created_at <= ${c}::timestamptz
    order by l.created_at desc, l.id desc
    limit ${limit}`;
  return rows.map((r) => ({
    id: String(r.id),
    teamName: r.team_name,
    delta: Number(r.points_delta),
    label: r.public_label,
    emoji: r.emoji ?? null,
    at: iso(r.created_at)!,
  }));
}

export async function manualAdjustment(tx: Tx, input: { teamId: string; delta: number; reason: string; publicLabel?: string }) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest("A reason is required for manual adjustments");
  if (!Number.isInteger(input.delta) || input.delta === 0 || Math.abs(input.delta) > 1000) {
    throw badRequest("Points must be a whole number between -1000 and 1000 (not 0)");
  }
  const [team] = await tx`select id, name from teams where id = ${input.teamId}`;
  if (!team) throw notFound("Team not found");
  const entry = await insertLedger(tx, {
    teamId: team.id,
    delta: input.delta,
    type: "manual_adjustment",
    reason,
    publicLabel: input.publicLabel?.trim() || (input.delta > 0 ? "Organizer bonus" : "Organizer correction"),
  });
  await audit(tx, "score.adjusted", { teamId: team.id, team: team.name, delta: input.delta, reason, ledgerId: entry.id });
  return entry;
}

/** Undo any ledger entry with a compensating transaction. History is never modified. */
export async function reverseLedgerEntry(tx: Tx, ledgerId: number, reason: string) {
  const why = reason.trim();
  if (why.length < 3) throw badRequest("A reason is required to reverse an entry");
  const [e] = await tx`select l.*, t.name as team_name from score_ledger l join teams t on t.id = l.team_id where l.id = ${ledgerId} for update of l`;
  if (!e) throw notFound("Ledger entry not found");
  if (e.entry_type === "reversal") throw conflict("A reversal cannot itself be reversed — add a manual adjustment instead");
  const [already] = await tx`select id from score_ledger where reverses_id = ${ledgerId}`;
  if (already) throw conflict("This entry has already been reversed");
  const entry = await insertLedger(tx, {
    teamId: e.team_id,
    challengeId: e.challenge_id,
    submissionId: e.submission_id,
    delta: -Number(e.points_delta),
    type: "reversal",
    reason: `Reversal of #${ledgerId}: ${why}`,
    publicLabel: "Organizer correction",
    reversesId: ledgerId,
  });
  await audit(tx, "score.reversed", { ledgerId, team: e.team_name, delta: -Number(e.points_delta), reason: why });
  return entry;
}
