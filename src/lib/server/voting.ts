import { db, withTx } from "./db";
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from "./errors";
import { audit } from "./audit";
import { hashVoteCode, normalizeCode } from "./crypto";
import { assertNotThrottled, recordFailure } from "./ratelimit";
import { finalizeChallenge } from "./challenges";

async function findVoter(code: string, ip: string) {
  await assertNotThrottled("vote-code", ip, 20);
  const norm = normalizeCode(code ?? "");
  if (norm.length < 5 || norm.length > 12) {
    await recordFailure("vote-code", ip);
    throw badRequest("That voting code doesn't look right");
  }
  const [p] = await db()`
    select p.id, p.name, p.team_id, t.name as team_name from participants p join teams t on t.id = p.team_id
    where p.vote_code_hash = ${hashVoteCode(norm)} and t.active`;
  if (!p) {
    await recordFailure("vote-code", ip);
    throw badRequest("Unknown voting code. Check your card or ask an organizer.");
  }
  return p;
}

export async function voterStatus(code: string, ip: string) {
  const p = await findVoter(code, ip);
  const [settings] = await db()`select voting_state from event_settings where id = 1`;
  const [vote] = await db()`select v.voted_team_id, t.name from votes v join teams t on t.id = v.voted_team_id where v.participant_id = ${p.id}`;
  const teams = await db()`select id, name, description from teams where active and id <> ${p.team_id} order by lower(name)`;
  return {
    voter: { name: p.name as string, team: p.team_name as string },
    votingState: settings?.voting_state ?? "not_open",
    votedFor: vote ? { teamId: vote.voted_team_id as string, name: vote.name as string } : null,
    teams: teams.map((t) => ({ id: t.id as string, name: t.name as string, description: (t.description as string) ?? null })),
  };
}

export async function castVote(code: string, teamId: string, ip: string) {
  const p = await findVoter(code, ip);
  try {
    return await withTx(async (tx) => {
      const [s] = await tx`select voting_state from event_settings where id = 1 for share`;
      if (s?.voting_state !== "open") throw conflict(s?.voting_state === "closed" ? "Voting has closed" : "Voting is not open yet");
      const [team] = await tx`select id, name from teams where id = ${teamId} and active`;
      if (!team) throw notFound("Team not found");
      if (team.id === p.team_id) throw new AppError(403, "You can't vote for your own team");
      await tx`insert into votes (participant_id, voted_team_id) values (${p.id}, ${team.id})`;
      return { votedFor: team.name as string };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("You have already voted — one vote per person");
    if ((e as { code?: string }).code === "23514") throw new AppError(403, "You can't vote for your own team");
    throw e;
  }
}

export async function voteCounts() {
  const rows = await db()`
    select t.id, t.name, count(v.id)::int as votes
    from teams t left join votes v on v.voted_team_id = t.id
    where t.active group by t.id order by votes desc, lower(t.name)`;
  const [{ voters, voted }] = await db()`
    select (select count(*)::int from participants p join teams t on t.id = p.team_id where t.active) as voters,
           (select count(*)::int from votes) as voted`;
  return { counts: rows.map((r) => ({ teamId: r.id as string, name: r.name as string, votes: r.votes as number })), voters, voted };
}

export async function setVotingState(state: "not_open" | "open" | "closed") {
  return withTx(async (tx) => {
    await tx`update event_settings set voting_state = ${state}, updated_at = now() where id = 1`;
    await audit(tx, `voting.${state === "open" ? "opened" : state === "closed" ? "closed" : "reset_to_not_open"}`, {});
  });
}

/**
 * Finalize People's Choice. Without explicit winners: a single top team wins; a tie is
 * returned (nothing awarded) so organizers can run a run-off or declare co-winners.
 */
export async function finalizePeoplesChoice(input: { challengeId?: string; winnerTeamIds?: string[]; mode?: "auto" | "co_winners" | "runoff_winner" }) {
  return withTx(async (tx) => {
    const [s] = await tx`select voting_state from event_settings where id = 1`;
    if (s.voting_state !== "closed") throw conflict("Close voting before finalizing People's Choice");
    const [c] = input.challengeId
      ? await tx`select id, title from challenges where id = ${input.challengeId} and challenge_type = 'VOTE'`
      : await tx`select id, title from challenges where challenge_type = 'VOTE' and status <> 'archived' order by sort_order limit 1`;
    if (!c) throw notFound("No People's Choice (VOTE) challenge found");
    const counts = await tx`
      select t.id, t.name, count(v.id)::int as votes from teams t left join votes v on v.voted_team_id = t.id
      where t.active group by t.id order by votes desc`;
    const top = counts[0]?.votes ?? 0;
    if (top === 0) throw conflict("No votes have been cast");
    const leaders = counts.filter((r) => r.votes === top);
    const mode = input.mode ?? "auto";

    let winners: string[];
    if (mode === "auto") {
      if (leaders.length > 1) {
        return { tie: true as const, leaders: leaders.map((l) => ({ teamId: l.id as string, name: l.name as string, votes: l.votes as number })) };
      }
      winners = [leaders[0].id];
    } else if (mode === "co_winners") {
      winners = leaders.map((l) => l.id as string);
    } else {
      const chosen = input.winnerTeamIds ?? [];
      if (chosen.length !== 1) throw badRequest("Pick exactly one run-off winner");
      if (!leaders.some((l) => l.id === chosen[0])) throw badRequest("The run-off winner must be one of the tied teams");
      winners = chosen;
    }
    const result = await finalizeChallenge(tx, {
      challengeId: c.id,
      winnerTeamIds: winners,
      note: mode === "co_winners" ? "tie — co-winners declared" : mode === "runoff_winner" ? "tie resolved by run-off" : undefined,
      extraAudit: { voting: { mode, counts: counts.map((r) => ({ team: r.name, votes: r.votes })) } },
    });
    return { tie: false as const, ...result };
  });
}
