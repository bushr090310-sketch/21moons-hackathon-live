import type { ChallengeType, EvidenceConfig, PublicChallenge, PublicEvent, PublicState, VotingState } from "@/lib/shared/types";
import { challengeState } from "@/lib/shared/challenge-state";
import { db, iso, num, type Tx } from "./db";
import { computeLeaderboard, recentActivity } from "./scoring";
import { storageHealth, storageMode } from "./storage";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------
async function loadSettings(tx: Tx) {
  const [s] = await tx`select *, now() as db_now from event_settings where id = 1`;
  return s;
}

function toPublicEvent(s: Record<string, unknown>): PublicEvent {
  return {
    name: s.event_name as string,
    location: s.event_location as string,
    startsAt: iso(s.event_starts_at),
    endsAt: iso(s.event_ends_at),
    frozen: !!s.leaderboard_frozen,
    frozenAt: iso(s.frozen_at),
    revealedAt: iso(s.revealed_at),
    votingState: s.voting_state as VotingState,
    submissionsOpen: !!s.submissions_open,
    sponsors: (s.sponsors as string[]) ?? [],
    announcement: (s.announcement as string) ?? null,
  };
}

interface WinnerInfo { firstGlobal: Map<string, { name: string; at: string }>; finals: Map<string, { name: string; at: string }[]> }

async function loadWinners(tx: Tx): Promise<WinnerInfo> {
  const fg = await tx`
    select s.challenge_id, t.name, s.reviewed_at from challenge_submissions s
    join teams t on t.id = s.team_id join challenges c on c.id = s.challenge_id
    where c.challenge_type = 'FIRST_GLOBAL' and s.status = 'approved'`;
  const fin = await tx`
    select l.challenge_id, t.name, l.created_at from score_ledger l join teams t on t.id = l.team_id
    where l.entry_type in ('final_award','vote_award')
      and not exists (select 1 from score_ledger r where r.reverses_id = l.id)
    order by l.created_at`;
  const firstGlobal = new Map<string, { name: string; at: string }>();
  for (const r of fg) firstGlobal.set(r.challenge_id, { name: r.name, at: iso(r.reviewed_at)! });
  const finals = new Map<string, { name: string; at: string }[]>();
  for (const r of fin) {
    const list = finals.get(r.challenge_id) ?? [];
    list.push({ name: r.name, at: iso(r.created_at)! });
    finals.set(r.challenge_id, list);
  }
  return { firstGlobal, finals };
}

function toPublicChallenge(
  c: Record<string, unknown>, nowMs: number, w: WinnerInfo, cutoffMs: number | null, showClaimer: boolean,
): PublicChallenge {
  const id = c.id as string;
  const fg = w.firstGlobal.get(id);
  const finals = w.finals.get(id) ?? [];
  const visibleAt = (at: string) => cutoffMs == null || new Date(at).getTime() <= cutoffMs;
  const state = challengeState({
    status: c.status as never, challenge_type: c.challenge_type as ChallengeType,
    reveal_at: c.reveal_at as Date, expires_at: c.expires_at as Date, finalized_at: c.finalized_at as Date, has_winner: !!fg,
  }, nowMs);
  const winnersVisible = finals.filter((f) => visibleAt(f.at)).map((f) => f.name);
  const meta = (c.metadata ?? {}) as Record<string, unknown>;
  return {
    id,
    slug: c.slug as string,
    emoji: c.emoji as string,
    title: c.title as string,
    shortDescription: c.short_description as string,
    fullDescription: c.full_description as string,
    points: c.points as number,
    type: c.challenge_type as ChallengeType,
    state,
    revealAt: iso(c.reveal_at),
    expiresAt: iso(c.expires_at),
    acceptsSubmissions: !!c.accepts_submissions,
    maxCompletions: c.max_completions_per_team as number,
    evidence: (c.evidence_config ?? {}) as EvidenceConfig,
    sensitive: !!meta.sensitive,
    claimedBy: fg && showClaimer && visibleAt(fg.at) ? fg.name : null,
    winners: winnersVisible,
    resultsHidden: finals.length > winnersVisible.length,
    sortOrder: c.sort_order as number,
  };
}

/**
 * Only REVEALED challenges ever leave the database for public/team callers.
 * Draft, archived and future-scheduled (incl. secret) rows are filtered in SQL.
 */
async function loadRevealedChallenges(tx: Tx) {
  return tx`
    select id, slug, emoji, title, short_description, full_description, points, challenge_type, status,
           reveal_at, expires_at, finalized_at, accepts_submissions, max_completions_per_team, evidence_config, metadata, sort_order
    from challenges
    where status in ('live','locked') or (status = 'scheduled' and reveal_at <= now())
    order by sort_order, reveal_at nulls last, title`;
}

async function nextDropAt(tx: Tx): Promise<string | null> {
  const [r] = await tx`
    select min(reveal_at) as at from challenges
    where status = 'scheduled' and reveal_at > now() and not is_secret`;
  return iso(r?.at);
}

// ---------------------------------------------------------------------------
// Public state (/, /display, /challenges)
// ---------------------------------------------------------------------------
let cache: { at: number; value: PublicState } | null = null;

export async function getPublicState({ fresh = false } = {}): Promise<PublicState> {
  if (!fresh && cache && Date.now() - cache.at < 1000) return cache.value;
  const value = await db().begin("isolation level repeatable read read only", async (tx) => {
    const s = await loadSettings(tx);
    const nowMs = new Date(s.db_now).getTime();
    const cutoff = s.leaderboard_frozen ? (s.frozen_at as Date) : null;
    const [leaderboard, activity, challengesRaw, winners, next] = await Promise.all([
      computeLeaderboard(tx, cutoff),
      recentActivity(tx, cutoff, 20),
      loadRevealedChallenges(tx),
      loadWinners(tx),
      nextDropAt(tx),
    ]);
    const cutoffMs = cutoff ? new Date(cutoff).getTime() : null;
    const challenges = challengesRaw.map((c) => toPublicChallenge(c, nowMs, winners, cutoffMs, !!s.show_first_global_winner));
    let voteResults: PublicState["voteResults"] = null;
    if (s.voting_results_public && s.voting_state === "closed") {
      const rows = await tx`
        select t.id, t.name, count(v.id)::int as votes from teams t left join votes v on v.voted_team_id = t.id
        where t.active group by t.id order by votes desc, lower(t.name)`;
      voteResults = rows.map((r) => ({ teamId: r.id, name: r.name, votes: r.votes }));
    }
    return {
      serverTime: new Date(nowMs).toISOString(),
      event: toPublicEvent(s),
      leaderboard,
      activity,
      challenges,
      nextDropAt: next,
      voteResults,
    } satisfies PublicState;
  });
  cache = { at: Date.now(), value: value as PublicState };
  return value as PublicState;
}

export function invalidatePublicCache() {
  cache = null;
}

// ---------------------------------------------------------------------------
// Team dashboard
// ---------------------------------------------------------------------------
export async function getTeamState(teamId: string) {
  const pub = await getPublicState({ fresh: true });
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const [team] = await tx`select id, name, description from teams where id = ${teamId}`;
    const members = await tx`select name from participants where team_id = ${teamId} order by created_at`;
    const subs = await tx`
      select s.id, s.challenge_id, s.status, s.description, s.evidence_url, s.numeric_value, s.submitted_at, s.reviewed_at,
             s.review_note, s.awarded_units, c.title, c.emoji, c.points,
             (select count(*)::int from submission_files f where f.submission_id = s.id) as files
      from challenge_submissions s join challenges c on c.id = s.challenge_id
      where s.team_id = ${teamId} order by s.submitted_at desc`;
    const cutoff = pub.event.frozen ? pub.event.frozenAt : null;
    const history = await tx`
      select l.id, l.points_delta, l.public_label, l.created_at from score_ledger l
      where l.team_id = ${teamId} and (${cutoff}::timestamptz is null or l.created_at <= ${cutoff}::timestamptz)
      order by l.created_at desc, l.id desc limit 50`;

    const row = pub.leaderboard.find((r) => r.teamId === teamId);
    const byChallenge = new Map<string, (typeof subs)[number][]>();
    for (const s of subs) {
      const list = byChallenge.get(s.challenge_id) ?? [];
      list.push(s);
      byChallenge.set(s.challenge_id, list);
    }
    const challenges = pub.challenges.map((c) => {
      const mine = byChallenge.get(c.id) ?? [];
      const pending = mine.find((s) => s.status === "pending");
      const approved = mine.filter((s) => s.status === "approved");
      const units = approved.reduce((a, s) => a + (s.awarded_units as number), 0);
      const lastRejected = mine.find((s) => s.status === "rejected");
      let canApply = true;
      let blockReason: string | null = null;
      if (!c.acceptsSubmissions) { canApply = false; blockReason = c.type === "VOTE" ? "Decided by People's Choice voting" : "Decided by the jury"; }
      else if (!pub.event.submissionsOpen) { canApply = false; blockReason = "Submissions paused"; }
      else if (c.state === "claimed") { canApply = false; blockReason = "Claimed"; }
      else if (c.state === "expired") { canApply = false; blockReason = "Expired"; }
      else if (c.state === "locked" || c.state === "finalized") { canApply = false; blockReason = "Locked"; }
      else if (pending) { canApply = false; blockReason = "Awaiting review"; }
      else if ((c.type === "FIRST_GLOBAL" || c.type === "OPEN_ONCE") && approved.length) { canApply = false; blockReason = "Completed"; }
      else if (c.type === "REPEATABLE" && units >= c.maxCompletions) { canApply = false; blockReason = "Max reached"; }
      return {
        ...c,
        my: {
          pending: !!pending,
          approvedCount: approved.length,
          units,
          rejectedNote: !pending && !approved.length && lastRejected ? (lastRejected.review_note as string) : null,
          canApply,
          blockReason,
        },
      };
    });

    return {
      team: { id: team.id as string, name: team.name as string, description: (team.description as string) ?? null },
      members: members.map((m) => m.name as string),
      score: row?.score ?? 0,
      rank: row?.rank ?? null,
      teamsCount: pub.leaderboard.length,
      event: pub.event,
      serverTime: pub.serverTime,
      nextDropAt: pub.nextDropAt,
      challenges,
      submissions: subs.map((s) => ({
        id: s.id as string,
        challengeId: s.challenge_id as string,
        challenge: s.title as string,
        emoji: s.emoji as string,
        status: s.status as string,
        description: s.description as string,
        evidenceUrl: (s.evidence_url as string) ?? null,
        numericValue: num(s.numeric_value),
        submittedAt: iso(s.submitted_at)!,
        reviewedAt: iso(s.reviewed_at),
        reviewNote: (s.review_note as string) ?? null,
        files: s.files as number,
      })),
      history: history.map((h) => ({ id: String(h.id), delta: Number(h.points_delta), label: h.public_label as string, at: iso(h.created_at)! })),
    };
  });
}
export type TeamState = Awaited<ReturnType<typeof getTeamState>>;

// ---------------------------------------------------------------------------
// Admin command center
// ---------------------------------------------------------------------------
export async function getAdminState() {
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const s = await loadSettings(tx);
    const nowMs = new Date(s.db_now).getTime();
    const cutoff = s.leaderboard_frozen ? (s.frozen_at as Date) : null;
    const [live, pub, activity, winners] = await Promise.all([
      computeLeaderboard(tx, null),
      cutoff ? computeLeaderboard(tx, cutoff) : Promise.resolve(null),
      recentActivity(tx, null, 30),
      loadWinners(tx),
    ]);
    const teams = await tx`
      select t.id, t.name, t.slug, t.description, t.active, t.is_demo, t.score_cached, t.created_at,
             coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'voted', exists(select 1 from votes v where v.participant_id = p.id))
                      order by p.created_at) filter (where p.id is not null), '[]') as participants
      from teams t left join participants p on p.team_id = t.id
      group by t.id order by t.active desc, lower(t.name)`;
    const challenges = await tx`
      select c.*,
        (select count(*)::int from challenge_submissions s where s.challenge_id = c.id and s.status = 'pending') as pending,
        (select count(*)::int from challenge_submissions s where s.challenge_id = c.id and s.status = 'approved') as approved
      from challenges c order by c.sort_order, c.reveal_at nulls last, c.title`;
    const subs = await tx`
      select s.id, s.seq, s.challenge_id, s.team_id, s.status, s.description, s.evidence_url, s.numeric_value, s.verified_value,
             s.submitted_at, s.reviewed_at, s.review_note, s.awarded_units,
             t.name as team_name, c.title as challenge_title, c.emoji, c.points, c.challenge_type, c.max_completions_per_team,
             coalesce((select json_agg(json_build_object('id', f.id, 'name', f.original_name, 'mime', f.mime, 'size', f.size_bytes) order by f.created_at)
                       from submission_files f where f.submission_id = s.id), '[]') as files
      from challenge_submissions s join teams t on t.id = s.team_id join challenges c on c.id = s.challenge_id
      order by (s.status = 'pending') desc,
               case when s.status = 'pending' then s.submitted_at end asc,
               s.reviewed_at desc nulls last
      limit 600`;
    const ledger = await tx`
      select l.id, l.team_id, t.name as team_name, l.points_delta, l.entry_type, l.reason, l.public_label, l.created_at,
             l.reverses_id, c.title as challenge_title,
             exists (select 1 from score_ledger r where r.reverses_id = l.id) as reversed
      from score_ledger l join teams t on t.id = l.team_id left join challenges c on c.id = l.challenge_id
      order by l.created_at desc, l.id desc limit 300`;
    const auditRows = await tx`select id, action, details, created_at from admin_audit_log order by created_at desc, id desc limit 150`;
    const votes = await tx`
      select t.id, t.name, count(v.id)::int as votes from teams t left join votes v on v.voted_team_id = t.id
      where t.active group by t.id order by votes desc, lower(t.name)`;
    const [voterStats] = await tx`
      select (select count(*)::int from participants p join teams t on t.id = p.team_id where t.active) as voters,
             (select count(*)::int from votes) as voted`;
    const [signals] = await tx`select coalesce(max(version), 0)::text as v from live_signals`;

    const challengeList = challenges.map((c) => {
      const pc = toPublicChallenge(c, nowMs, winners, null, true);
      return {
        ...pc,
        status: c.status as string,
        isSecret: !!c.is_secret,
        awardMode: c.award_mode as string,
        finalizedAt: iso(c.finalized_at),
        pending: c.pending as number,
        approved: c.approved as number,
        metadata: c.metadata as Record<string, unknown>,
        winnersAll: (winners.finals.get(c.id) ?? []).map((w) => w.name),
        claimedByAll: winners.firstGlobal.get(c.id)?.name ?? null,
      };
    });
    const pendingCount = subs.filter((x) => x.status === "pending").length;
    const upcoming = challengeList
      .filter((c) => c.state === "scheduled" && c.revealAt)
      .sort((a, b) => new Date(a.revealAt!).getTime() - new Date(b.revealAt!).getTime());

    return {
      serverTime: new Date(nowMs).toISOString(),
      signal: signals.v as string,
      settings: {
        ...toPublicEvent(s),
        votingResultsPublic: !!s.voting_results_public,
        showFirstGlobalWinner: !!s.show_first_global_winner,
      },
      stats: {
        teams: teams.filter((t) => t.active).length,
        pending: pendingCount,
        activeChallenges: challengeList.filter((c) => c.state === "active").length,
        nextScheduled: upcoming[0] ? { id: upcoming[0].id, title: upcoming[0].title, emoji: upcoming[0].emoji, revealAt: upcoming[0].revealAt, isSecret: upcoming[0].isSecret } : null,
      },
      leaderboard: live,
      publicLeaderboard: pub,
      activity,
      teams: teams.map((t) => ({
        id: t.id as string, name: t.name as string, slug: t.slug as string, description: (t.description as string) ?? null,
        active: !!t.active, isDemo: !!t.is_demo, score: t.score_cached as number,
        participants: t.participants as { id: string; name: string; voted: boolean }[],
      })),
      challenges: challengeList,
      submissions: subs.map((x) => ({
        id: x.id as string, seq: Number(x.seq), challengeId: x.challenge_id as string, teamId: x.team_id as string,
        status: x.status as "pending" | "approved" | "rejected", description: x.description as string,
        evidenceUrl: (x.evidence_url as string) ?? null, numericValue: num(x.numeric_value), verifiedValue: num(x.verified_value),
        submittedAt: iso(x.submitted_at)!, reviewedAt: iso(x.reviewed_at), reviewNote: (x.review_note as string) ?? null,
        awardedUnits: x.awarded_units as number, teamName: x.team_name as string, challengeTitle: x.challenge_title as string,
        emoji: x.emoji as string, points: x.points as number, challengeType: x.challenge_type as ChallengeType,
        maxCompletions: x.max_completions_per_team as number,
        files: x.files as { id: string; name: string | null; mime: string; size: number }[],
      })),
      ledger: ledger.map((l) => ({
        id: Number(l.id), teamId: l.team_id as string, teamName: l.team_name as string, delta: Number(l.points_delta),
        type: l.entry_type as string, reason: l.reason as string, publicLabel: l.public_label as string,
        at: iso(l.created_at)!, reversesId: l.reverses_id == null ? null : Number(l.reverses_id),
        reversed: !!l.reversed, challenge: (l.challenge_title as string) ?? null,
      })),
      audit: auditRows.map((a) => ({ id: Number(a.id), action: a.action as string, details: a.details as Record<string, unknown>, at: iso(a.created_at)! })),
      voting: {
        counts: votes.map((v) => ({ teamId: v.id as string, name: v.name as string, votes: v.votes as number })),
        voters: voterStats.voters as number,
        voted: voterStats.voted as number,
      },
      system: { storage: storageMode() },
    };
  });
}
export type AdminState = Awaited<ReturnType<typeof getAdminState>>;

export async function getHealth() {
  const [r] = await db()`select count(*)::int as n from schema_migrations`;
  return { db: true, migrations: r.n as number, storage: await storageHealth() };
}
