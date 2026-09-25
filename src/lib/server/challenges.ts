import { z } from "zod";
import { awardModeFor } from "@/lib/shared/challenge-state";
import { CHALLENGE_TYPES, type ChallengeType } from "@/lib/shared/types";
import { withTx, type Tx } from "./db";
import { badRequest, conflict, isUniqueViolation, notFound } from "./errors";
import { audit } from "./audit";
import { insertLedger } from "./scoring";

const isoOrNull = z.union([z.string().datetime({ offset: true }), z.null()]).optional();

export const challengeInput = z.object({
  title: z.string().trim().min(1).max(80),
  emoji: z.string().trim().min(1).max(16).default("✨"),
  shortDescription: z.string().trim().max(400).default(""),
  fullDescription: z.string().trim().max(4000).default(""),
  points: z.number().int().min(-1000).max(1000),
  type: z.enum(CHALLENGE_TYPES as [ChallengeType, ...ChallengeType[]]),
  status: z.enum(["draft", "scheduled", "live", "locked", "archived"]).default("draft"),
  revealAt: isoOrNull,
  expiresAt: isoOrNull,
  isSecret: z.boolean().default(false),
  maxCompletions: z.number().int().min(1).max(100).default(1),
  acceptsSubmissions: z.boolean().default(true),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
  evidence: z.object({
    requireUrl: z.boolean().optional(),
    allowFiles: z.boolean().optional(),
    numericLabel: z.string().trim().max(60).nullable().optional(),
    numericRequired: z.boolean().optional(),
    hint: z.string().trim().max(300).optional(),
  }).default({}),
});
export type ChallengeInput = z.infer<typeof challengeInput>;

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 50) || "challenge";
}

async function uniqueSlug(tx: Tx, base: string, excludeId?: string) {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    const rows = await tx`select id from challenges where slug = ${slug} and id is distinct from ${excludeId ?? null}::uuid`;
    if (!rows.length) return slug;
  }
  return `${root}-${Date.now()}`;
}

function validateTimes(i: ChallengeInput) {
  if (i.status === "scheduled" && !i.revealAt) throw badRequest("Scheduled challenges need a reveal time");
  if (i.revealAt && i.expiresAt && new Date(i.expiresAt) <= new Date(i.revealAt)) {
    throw badRequest("Expiry must be after the reveal time");
  }
}

export async function createChallenge(input: ChallengeInput) {
  validateTimes(input);
  return withTx(async (tx) => {
    const slug = await uniqueSlug(tx, input.title);
    const [row] = await tx`
      insert into challenges (slug, title, emoji, short_description, full_description, points, challenge_type, award_mode,
        status, reveal_at, expires_at, is_secret, max_completions_per_team, accepts_submissions, sort_order, evidence_config)
      values (${slug}, ${input.title}, ${input.emoji}, ${input.shortDescription}, ${input.fullDescription}, ${input.points},
        ${input.type}, ${awardModeFor(input.type)}, ${input.status}, ${input.revealAt ?? null}, ${input.expiresAt ?? null},
        ${input.isSecret}, ${input.maxCompletions}, ${input.acceptsSubmissions}, ${input.sortOrder}, ${tx.json(input.evidence as never)})
      returning id`;
    await audit(tx, "challenge.created", { id: row.id, title: input.title, status: input.status });
    return { id: row.id as string };
  });
}

export async function updateChallenge(id: string, input: ChallengeInput) {
  validateTimes(input);
  return withTx(async (tx) => {
    const [c] = await tx`select * from challenges where id = ${id} for update`;
    if (!c) throw notFound("Challenge not found");
    if (c.challenge_type !== input.type) {
      const [used] = await tx`
        select (select count(*) from challenge_submissions where challenge_id = ${id} and status = 'approved')
             + (select count(*) from score_ledger where challenge_id = ${id}) as n`;
      if (Number(used.n) > 0) throw conflict("Can't change the type after approvals or awards exist. Duplicate the challenge instead.");
    }
    await tx`
      update challenges set
        title = ${input.title}, emoji = ${input.emoji}, short_description = ${input.shortDescription},
        full_description = ${input.fullDescription}, points = ${input.points}, challenge_type = ${input.type},
        award_mode = ${awardModeFor(input.type)}, status = ${input.status}, reveal_at = ${input.revealAt ?? null},
        expires_at = ${input.expiresAt ?? null}, is_secret = ${input.isSecret}, max_completions_per_team = ${input.maxCompletions},
        accepts_submissions = ${input.acceptsSubmissions}, sort_order = ${input.sortOrder},
        evidence_config = ${tx.json(input.evidence as never)}, updated_at = now()
      where id = ${id}`;
    const changes: Record<string, unknown> = {};
    if (c.points !== input.points) changes.points = { from: c.points, to: input.points, note: "existing awards unchanged" };
    if (c.status !== input.status) changes.status = { from: c.status, to: input.status };
    await audit(tx, "challenge.updated", { id, title: input.title, ...changes });
  });
}

export type ChallengeCommand = "activate" | "hide" | "lock" | "unlock" | "archive" | "duplicate" | "reopen";

export async function challengeCommand(id: string, cmd: ChallengeCommand) {
  return withTx(async (tx) => {
    const [c] = await tx`select * from challenges where id = ${id} for update`;
    if (!c) throw notFound("Challenge not found");
    switch (cmd) {
      case "activate":
        // Reveal immediately (the reveal time drives the CHALLENGE DROP animation).
        await tx`update challenges set status = 'live', reveal_at = now(), updated_at = now() where id = ${id}`;
        await audit(tx, "challenge.activated", { id, title: c.title });
        return { ok: true };
      case "hide":
        await tx`update challenges set status = 'draft', updated_at = now() where id = ${id}`;
        await audit(tx, "challenge.hidden", { id, title: c.title });
        return { ok: true };
      case "lock":
        await tx`update challenges set status = 'locked', reveal_at = coalesce(reveal_at, now()), updated_at = now() where id = ${id}`;
        await audit(tx, "challenge.locked", { id, title: c.title });
        return { ok: true };
      case "unlock": {
        if (c.challenge_type === "FIRST_GLOBAL") {
          const [w] = await tx`select 1 from challenge_submissions where challenge_id = ${id} and status = 'approved' limit 1`;
          if (w) throw conflict("This FIRST challenge has a winner. Revoke the winning approval to reopen it.");
        }
        await tx`update challenges set status = 'live', reveal_at = coalesce(reveal_at, now()), updated_at = now() where id = ${id}`;
        await audit(tx, "challenge.unlocked", { id, title: c.title });
        return { ok: true };
      }
      case "archive":
        await tx`update challenges set status = 'archived', updated_at = now() where id = ${id}`;
        await audit(tx, "challenge.archived", { id, title: c.title });
        return { ok: true };
      case "reopen":
        if (!c.finalized_at) throw conflict("Challenge is not finalized");
        await tx`update challenges set finalized_at = null, status = 'live', updated_at = now() where id = ${id}`;
        await audit(tx, "challenge.reopened", { id, title: c.title, note: "existing final awards kept; reverse them in Scores if needed" });
        return { ok: true };
      case "duplicate": {
        const slug = await uniqueSlug(tx, c.slug + "-copy");
        const [row] = await tx`
          insert into challenges (slug, title, emoji, short_description, full_description, points, challenge_type, award_mode,
            status, reveal_at, expires_at, is_secret, max_completions_per_team, accepts_submissions, sort_order, evidence_config, metadata)
          select ${slug}, left(title || ' (copy)', 80), emoji, short_description, full_description, points, challenge_type, award_mode,
            'draft', null, null, is_secret, max_completions_per_team, accepts_submissions, sort_order + 1, evidence_config, metadata
          from challenges where id = ${id} returning id`;
        await audit(tx, "challenge.duplicated", { from: id, id: row.id, title: c.title });
        return { ok: true, id: row.id as string };
      }
    }
  });
}

/**
 * Award a COMPETITIVE / JUDGED / VOTE challenge. Guards against double awarding:
 * the challenge row is locked, finalized_at is checked, and a team with an
 * un-reversed final award for this challenge can't be awarded again.
 */
export async function finalizeChallenge(tx: Tx, input: { challengeId: string; winnerTeamIds: string[]; points?: number; note?: string; extraAudit?: Record<string, unknown> }) {
  const winners = [...new Set(input.winnerTeamIds)];
  if (!winners.length) throw badRequest("Select at least one winning team");
  const [c] = await tx`select * from challenges where id = ${input.challengeId} for update`;
  if (!c) throw notFound("Challenge not found");
  const type = c.challenge_type as ChallengeType;
  if (!["COMPETITIVE", "JUDGED", "VOTE"].includes(type)) {
    throw badRequest("Only competitive, judged and vote challenges are finalized — the others award on approval");
  }
  if (c.finalized_at) throw conflict("This challenge is already finalized. Reopen it first if you need to add a winner.");
  const points = input.points ?? c.points;
  if (!Number.isInteger(points) || points === 0) throw badRequest("Award points must be a non-zero whole number");

  const teams = await tx`select id, name from teams where id = any(${winners}::uuid[]) and active`;
  if (teams.length !== winners.length) throw badRequest("One of the selected teams doesn't exist or is archived");

  if (type === "COMPETITIVE") {
    const eligible = await tx`
      select distinct team_id from challenge_submissions
      where challenge_id = ${c.id} and status = 'approved' and team_id = any(${winners}::uuid[])`;
    if (eligible.length !== winners.length) {
      throw conflict("Competitive winners need an approved (verified) entry first. Approve their entry in the inbox.");
    }
  }

  const awarded: { team: string; points: number }[] = [];
  for (const t of teams) {
    const [prev] = await tx`
      select count(*)::int as total,
             count(*) filter (where not exists (select 1 from score_ledger r where r.reverses_id = l.id))::int as active
      from score_ledger l
      where l.challenge_id = ${c.id} and l.team_id = ${t.id} and l.entry_type in ('final_award','vote_award')`;
    if (prev.active > 0) throw conflict(`${t.name} has already been awarded ${c.title}`);
    await insertLedger(tx, {
      teamId: t.id,
      challengeId: c.id,
      delta: points,
      type: type === "VOTE" ? "vote_award" : "final_award",
      reason: `${c.title} winner${winners.length > 1 ? " (co-winner)" : ""}${input.note ? ` — ${input.note}` : ""}`,
      publicLabel: `${c.title}${winners.length > 1 ? " (shared)" : ""}`,
      awardKey: `final:${c.id}:${t.id}:${prev.total + 1}`,
    });
    awarded.push({ team: t.name, points });
  }
  await tx`update challenges set finalized_at = now(), status = 'locked', reveal_at = coalesce(reveal_at, now()), updated_at = now() where id = ${c.id}`;
  await audit(tx, "challenge.finalized", { id: c.id, title: c.title, winners: awarded, ...(input.extraAudit ?? {}) });
  return { awarded, challenge: c.title as string };
}

export async function finalizeChallengeTx(input: Parameters<typeof finalizeChallenge>[1]) {
  try {
    return await withTx((tx) => finalizeChallenge(tx, input));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("That award already exists");
    throw e;
  }
}
