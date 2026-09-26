// ☄️ COSMIC POWERS — earned, never free. Attacks use the EXISTING append-only ledger
// via a NEW negative entry; nothing historic is ever edited.
import { POWERS, attackDelta, type PowerType } from "@/lib/shared/universe";
import { db, iso, withTx, type Tx } from "../db";
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from "../errors";
import { audit } from "../audit";
import { insertLedger } from "../scoring";
import { eventContext, publishNews, requireUniverseLive } from "./core";

export const ATTACK_RATE = { max: 2, windowSeconds: 60 };

export async function grantPower(tx: Tx, input: { teamId: string; type: PowerType; source: "admin" | "challenge"; challengeId?: string | null; submissionId?: string | null; note?: string }) {
  const [team] = await tx`select id, name, active from teams where id = ${input.teamId}`;
  if (!team || !team.active) throw notFound("Team not found or archived");
  const rows = await tx`
    insert into team_powerups (team_id, powerup_type, value, source, earned_from_challenge_id, earned_from_submission_id, metadata)
    values (${team.id}, ${input.type}, ${POWERS[input.type].value}, ${input.source}, ${input.challengeId ?? null},
            ${input.submissionId ?? null}, ${tx.json({ note: input.note ?? null } as never)})
    on conflict (earned_from_submission_id) where earned_from_submission_id is not null do nothing
    returning id`;
  if (!rows.length) return null;
  const p = POWERS[input.type];
  await publishNews(tx, {
    type: "POWER_EARNED", emoji: p.emoji, importance: "normal", teamId: team.id,
    headline: `${team.name.toUpperCase()} EARNED A ${p.name.toUpperCase()}`,
    body: p.does, dedupeKey: `earned:${rows[0].id}`,
  });
  await audit(tx, "universe.power_granted", { team: team.name, type: input.type, source: input.source, powerupId: rows[0].id, challengeId: input.challengeId ?? null });
  return rows[0].id as string;
}

export async function adminGrantPower(teamId: string, type: PowerType, note?: string) {
  return withTx(async (tx) => {
    await requireUniverseLive(tx);
    return grantPower(tx, { teamId, type, source: "admin", note });
  });
}

export async function revokePower(powerupId: string, reason: string) {
  if (!reason || reason.trim().length < 3) throw badRequest("A reason is required");
  return withTx(async (tx) => {
    const [p] = await tx`select p.*, t.name from team_powerups p join teams t on t.id = p.team_id where p.id = ${powerupId} for update of p`;
    if (!p) throw notFound("Power not found");
    if (p.status !== "available") throw conflict("Only unused powers can be revoked");
    await tx`update team_powerups set status = 'revoked', metadata = metadata || ${tx.json({ revokedReason: reason.trim() } as never)} where id = ${powerupId}`;
    await audit(tx, "universe.power_revoked", { team: p.name, type: p.powerup_type, powerupId, reason: reason.trim() });
  });
}

/**
 * Grant powers for approved submissions of challenges that carry a reward.
 * Only approvals made AFTER the reward was attached count (no retroactive grants).
 * Unused powers whose approval was later revoked are revoked too. Idempotent.
 */
export async function reconcileRewards(tx: Tx) {
  const due = await tx`
    select s.id as submission_id, s.team_id, s.challenge_id, r.powerup_type
    from challenge_power_rewards r
    join challenge_submissions s on s.challenge_id = r.challenge_id and s.status = 'approved' and s.reviewed_at >= r.created_at
    join teams t on t.id = s.team_id and t.active
    where not exists (select 1 from team_powerups p where p.earned_from_submission_id = s.id)`;
  let granted = 0;
  for (const d of due) {
    const id = await grantPower(tx, { teamId: d.team_id, type: d.powerup_type, source: "challenge", challengeId: d.challenge_id, submissionId: d.submission_id });
    if (id) granted++;
  }
  const revoked = await tx`
    update team_powerups p set status = 'revoked', metadata = p.metadata || '{"revokedReason":"challenge approval revoked"}'::jsonb
    from challenge_submissions s
    where p.earned_from_submission_id = s.id and p.status = 'available' and s.status <> 'approved'
    returning p.id`;
  return { granted, revoked: revoked.length };
}

export async function setChallengeReward(challengeId: string, type: PowerType | null) {
  return withTx(async (tx) => {
    const [c] = await tx`select id, title from challenges where id = ${challengeId}`;
    if (!c) throw notFound("Challenge not found");
    if (type === null) {
      await tx`delete from challenge_power_rewards where challenge_id = ${challengeId}`;
      await audit(tx, "universe.reward_removed", { challenge: c.title });
      return;
    }
    await tx`
      insert into challenge_power_rewards (challenge_id, powerup_type) values (${challengeId}, ${type})
      on conflict (challenge_id) do update set powerup_type = excluded.powerup_type`;
    await audit(tx, "universe.reward_set", { challenge: c.title, type, note: "applies only to approvals from now on" });
  });
}

export interface AttackResult {
  blocked: boolean;
  appliedDelta: number;
  target: string;
  attacker: string;
  type: PowerType;
  replay?: boolean;
}

/**
 * Use a sabotage power. Transactional: consumes exactly one power, applies at most
 * the target's current score (never below 0), or consumes the target's Force Field.
 */
export async function usePower(attackerTeamId: string, input: { powerupId: string; targetTeamId: string; requestId: string }): Promise<AttackResult> {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId)) throw badRequest("Invalid request id");
  try {
    return await withTx(async (tx) => {
      await requireUniverseLive(tx);
      // Idempotency: the same click delivered twice returns the first result.
      const [prior] = await tx`
        select a.*, ta.name as attacker, tt.name as target from power_attacks a
        join teams ta on ta.id = a.attacker_team_id join teams tt on tt.id = a.target_team_id
        where a.request_id = ${input.requestId}`;
      if (prior) {
        if (prior.attacker_team_id !== attackerTeamId) throw conflict("Request already used");
        return { blocked: prior.blocked, appliedDelta: prior.applied_delta, target: prior.target, attacker: prior.attacker, type: prior.powerup_type, replay: true };
      }
      const ctx = await eventContext(tx);
      if (ctx.frozen) throw conflict("Cosmic powers are paused while the leaderboard is frozen");
      if (input.targetTeamId === attackerTeamId) throw badRequest("You can't attack your own Moon");

      const [power] = await tx`select * from team_powerups where id = ${input.powerupId} and team_id = ${attackerTeamId} for update`;
      if (!power) throw notFound("Power not found");
      if (power.status !== "available") throw conflict("This power has already been used");
      const type = power.powerup_type as PowerType;
      if (type === "SHIELD") throw badRequest("A Force Field works automatically — it can't be launched");

      const [{ n }] = await tx`
        select count(*)::int as n from power_attacks
        where attacker_team_id = ${attackerTeamId} and created_at > now() - make_interval(secs => ${ATTACK_RATE.windowSeconds})`;
      if (n >= ATTACK_RATE.max) throw new AppError(429, "Easy, commander — wait a minute before launching again");

      const [attacker] = await tx`select id, name, active from teams where id = ${attackerTeamId}`;
      if (!attacker?.active) throw new AppError(403, "Team is not active");
      // Lock the target row: serializes concurrent attacks and shield use on the same Moon.
      const [target] = await tx`select id, name, active from teams where id = ${input.targetTeamId} for update`;
      if (!target || !target.active) throw badRequest("That Moon can't be targeted");

      const p = POWERS[type];
      const [shield] = await tx`
        select id from team_powerups where team_id = ${target.id} and powerup_type = 'SHIELD' and status = 'available'
        order by earned_at, id limit 1 for update`;

      if (shield) {
        await tx`update team_powerups set status = 'used', used_at = now(), target_team_id = ${attacker.id},
                   metadata = metadata || ${tx.json({ blockedAttackFrom: attacker.name, blockedPowerId: power.id } as never)}
                 where id = ${shield.id}`;
        await tx`update team_powerups set status = 'used', used_at = now(), target_team_id = ${target.id},
                   metadata = metadata || '{"outcome":"blocked"}'::jsonb where id = ${power.id}`;
        await tx`
          insert into power_attacks (request_id, powerup_id, attacker_team_id, target_team_id, powerup_type, requested_delta, applied_delta, blocked, shield_powerup_id)
          values (${input.requestId}, ${power.id}, ${attacker.id}, ${target.id}, ${type}, ${-p.value}, 0, true, ${shield.id})`;
        await publishNews(tx, {
          type: "ATTACK_BLOCKED", emoji: "🛡️", importance: "breaking", takeover: true,
          headline: `FORCE FIELD ACTIVATED — ${target.name.toUpperCase()} BLOCKED THE ATTACK`,
          body: `${attacker.name}'s ${p.name} bounced off. No pts lost.`,
          teamId: target.id, targetTeamId: attacker.id, pointsDelta: 0,
          dedupeKey: `attack:${power.id}`, metadata: { attacker: attacker.name, target: target.name, power: type },
        });
        await audit(tx, "universe.attack_blocked", { attacker: attacker.name, target: target.name, type, powerupId: power.id, shieldId: shield.id });
        return { blocked: true, appliedDelta: 0, target: target.name, attacker: attacker.name, type };
      }

      const [{ score }] = await tx`select coalesce(sum(points_delta), 0)::int as score from score_ledger where team_id = ${target.id}`;
      const applied = attackDelta(p.value, score);
      if (applied === 0) throw conflict(`${target.name} has 0 pts — there's nothing to strike`);

      const entry = await insertLedger(tx, {
        teamId: target.id,
        delta: -applied,
        type: "manual_adjustment",
        reason: `${p.name} by ${attacker.name} (cosmic power ${power.id})`,
        publicLabel: `${p.emoji} ${p.name} by ${attacker.name}`,
        awardKey: `power:${power.id}`, // DB-unique: a power can never hit twice
      });
      await tx`update team_powerups set status = 'used', used_at = now(), target_team_id = ${target.id},
                 metadata = metadata || ${tx.json({ outcome: "hit", appliedDelta: -applied } as never)} where id = ${power.id}`;
      await tx`
        insert into power_attacks (request_id, powerup_id, attacker_team_id, target_team_id, powerup_type, requested_delta, applied_delta, blocked, ledger_id)
        values (${input.requestId}, ${power.id}, ${attacker.id}, ${target.id}, ${type}, ${-p.value}, ${-applied}, false, ${entry.id})`;
      await publishNews(tx, {
        type: "ATTACK", emoji: p.emoji, importance: "breaking", takeover: true,
        headline: `${p.name.toUpperCase()} — ${attacker.name.toUpperCase()} HAS STRUCK ${target.name.toUpperCase()}`,
        body: `−${applied} pts`, teamId: attacker.id, targetTeamId: target.id, pointsDelta: -applied,
        dedupeKey: `attack:${power.id}`, metadata: { attacker: attacker.name, target: target.name, power: type },
      });
      await audit(tx, "universe.attack", { attacker: attacker.name, target: target.name, type, applied: -applied, ledgerId: entry.id, powerupId: power.id });
      return { blocked: false, appliedDelta: -applied, target: target.name, attacker: attacker.name, type };
    });
  } catch (e) {
    // Concurrent duplicate of the same request or power → treat as already used.
    if (isUniqueViolation(e)) throw conflict("This power has already been used");
    throw e;
  }
}

export async function teamPowers(teamId: string) {
  const rows = await db()`
    select id, powerup_type, status, earned_at, used_at from team_powerups
    where team_id = ${teamId} and status in ('available','used') order by earned_at`;
  return rows.map((r) => ({ id: r.id as string, type: r.powerup_type as PowerType, status: r.status as string, earnedAt: iso(r.earned_at)!, usedAt: iso(r.used_at) }));
}
