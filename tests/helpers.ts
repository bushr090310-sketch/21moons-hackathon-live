import { db } from "@/lib/server/db";
import { invalidatePublicCache } from "@/lib/server/state";
import { createChallenge, type ChallengeInput } from "@/lib/server/challenges";
import { createTeam } from "@/lib/server/teams";

export async function resetDb() {
  invalidatePublicCache();
  const sql = db();
  await sql`truncate score_ledger, votes, submission_files, challenge_submissions, participants, team_secrets, teams,
            admin_audit_log, auth_attempts, local_evidence_objects restart identity cascade`;
  await sql`delete from challenges where slug like 't-%' or slug like 'test-%'`;
  await sql`update event_settings set leaderboard_frozen = false, frozen_at = null, revealed_at = null,
            voting_state = 'not_open', submissions_open = true, voting_results_public = false where id = 1`;
}

let n = 0;
export async function makeChallenge(over: Partial<ChallengeInput> = {}) {
  n++;
  const input: ChallengeInput = {
    title: `test-${n}-${over.type ?? "OPEN_ONCE"}`,
    emoji: "🧪",
    shortDescription: "test",
    fullDescription: "test",
    points: 20,
    type: "OPEN_ONCE",
    status: "live",
    revealAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: null,
    isSecret: false,
    maxCompletions: 1,
    acceptsSubmissions: true,
    sortOrder: 0,
    evidence: {},
    ...over,
  };
  const { id } = await createChallenge(input);
  return id;
}

export async function makeTeam(name: string, participants = ["A " + name, "B " + name]) {
  return createTeam({ name, participants });
}

export async function scoreOf(teamId: string) {
  const [r] = await db()`select coalesce(sum(points_delta),0)::int as s from score_ledger where team_id = ${teamId}`;
  const [c] = await db()`select score_cached from teams where id = ${teamId}`;
  return { ledger: r.s as number, cached: c.score_cached as number };
}

export async function ledgerCount(teamId: string) {
  const [r] = await db()`select count(*)::int as n from score_ledger where team_id = ${teamId}`;
  return r.n as number;
}
