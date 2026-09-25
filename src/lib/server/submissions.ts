import crypto from "node:crypto";
import type { ChallengeType, EvidenceConfig } from "@/lib/shared/types";
import { challengeState } from "@/lib/shared/challenge-state";
import { fmtTimeSec } from "@/lib/shared/time";
import { db, withTx, type Tx } from "./db";
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from "./errors";
import { audit } from "./audit";
import { insertLedger } from "./scoring";
import {
  ALLOWED_MIME, MAX_FILE_BYTES, MAX_FILES, createUploadTarget, readObject, removeObject, sniffMime,
} from "./storage";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
export function sanitizeUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (!v) return null;
  if (v.length > 1000) throw badRequest("URL is too long");
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
  } catch {
    throw badRequest("That doesn't look like a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw badRequest("Only http(s) links are allowed");
  if (!u.hostname.includes(".") && u.hostname !== "localhost") throw badRequest("That doesn't look like a valid URL");
  u.username = "";
  u.password = "";
  return u.toString();
}

async function lockChallenge(tx: Tx, challengeId: string, mode: "update" | "share") {
  const rows = mode === "update"
    ? await tx`select * from challenges where id = ${challengeId} for update`
    : await tx`select * from challenges where id = ${challengeId} for share`;
  return rows[0] ?? null;
}

async function firstGlobalWinner(tx: Tx, challengeId: string) {
  const [w] = await tx`
    select s.id, s.team_id, t.name from challenge_submissions s join teams t on t.id = s.team_id
    where s.challenge_id = ${challengeId} and s.status = 'approved' limit 1`;
  return w ?? null;
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
export async function createUploadSlot(teamId: string, input: { name: string; mime: string; size: number }) {
  const ext = ALLOWED_MIME[input.mime];
  if (!ext) throw badRequest("Only JPEG, PNG, WebP and PDF files are allowed. For video, share a link instead.");
  if (!Number.isInteger(input.size) || input.size <= 0) throw badRequest("Empty file");
  if (input.size > MAX_FILE_BYTES) throw badRequest("Files must be 8 MB or smaller. For video, share a link instead.");
  const [{ n }] = await db()`
    select count(*)::int as n from submission_files
    where team_id = ${teamId} and submission_id is null and created_at > now() - interval '1 hour'`;
  if (n >= 12) throw new AppError(429, "Too many pending uploads. Submit your application first.");
  const id = crypto.randomUUID();
  const path = `${teamId}/${id}.${ext}`;
  await db()`
    insert into submission_files (id, team_id, storage_path, original_name, mime, size_bytes)
    values (${id}, ${teamId}, ${path}, ${input.name.slice(0, 200)}, ${input.mime}, ${input.size})`;
  const target = await createUploadTarget(path, input.mime, id);
  return { fileId: id, upload: target };
}

/** Database-mode upload (local development only; production uses signed Storage URLs). */
export async function storeLocalUpload(teamId: string, fileId: string, bytes: Uint8Array) {
  const [f] = await db()`select * from submission_files where id = ${fileId} and team_id = ${teamId} and submission_id is null`;
  if (!f) throw notFound("Upload slot not found");
  if (bytes.byteLength > MAX_FILE_BYTES) throw badRequest("File too large");
  await db()`
    insert into local_evidence_objects (storage_path, mime, data) values (${f.storage_path}, ${f.mime}, ${Buffer.from(bytes)})
    on conflict (storage_path) do nothing`;
}

async function verifyFiles(teamId: string, fileIds: string[]) {
  const ids = [...new Set(fileIds)];
  if (ids.length > MAX_FILES) throw badRequest(`Maximum ${MAX_FILES} files per application`);
  if (!ids.length) return [];
  const rows = await db()`
    select * from submission_files where id = any(${ids}::uuid[]) and team_id = ${teamId} and submission_id is null`;
  if (rows.length !== ids.length) throw badRequest("One of the uploaded files is missing — please upload it again");
  for (const f of rows) {
    const obj = await readObject(f.storage_path);
    if (!obj) throw badRequest(`"${f.original_name ?? "file"}" did not finish uploading — please try again`);
    const sniffed = sniffMime(obj.bytes.subarray(0, 16));
    if (obj.bytes.byteLength > MAX_FILE_BYTES || !sniffed || sniffed !== f.mime) {
      await removeObject(f.storage_path);
      await db()`delete from submission_files where id = ${f.id}`;
      throw badRequest(`"${f.original_name ?? "file"}" is not a valid JPEG, PNG, WebP or PDF`);
    }
    if (obj.bytes.byteLength !== f.size_bytes) {
      await db()`update submission_files set size_bytes = ${obj.bytes.byteLength} where id = ${f.id}`;
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Team submits an application
// ---------------------------------------------------------------------------
export interface SubmitInput {
  challengeId: string;
  description: string;
  evidenceUrl?: string | null;
  numericValue?: number | null;
  fileIds?: string[];
}

export async function submitApplication(teamId: string, input: SubmitInput) {
  const description = input.description?.trim() ?? "";
  if (description.length < 3) throw badRequest("Please describe what you did (at least a sentence)");
  if (description.length > 2000) throw badRequest("Description is too long (max 2000 characters)");
  const url = sanitizeUrl(input.evidenceUrl);
  const numeric = input.numericValue == null || Number.isNaN(input.numericValue) ? null : Number(input.numericValue);
  if (numeric != null && (!Number.isFinite(numeric) || Math.abs(numeric) > 1e12)) throw badRequest("Invalid number");

  const fileIds = await verifyFiles(teamId, input.fileIds ?? []);

  try {
    return await withTx(async (tx) => {
      const [team] = await tx`select id, name, active from teams where id = ${teamId}`;
      if (!team || !team.active) throw new AppError(403, "Team is not active");
      const [settings] = await tx`select submissions_open from event_settings where id = 1`;
      if (settings && !settings.submissions_open) throw conflict("Submissions are currently paused by the organizers");

      // FOR SHARE: waits for any in-flight approval on this challenge, so "claimed" is accurate.
      const c = await lockChallenge(tx, input.challengeId, "share");
      const [{ now }] = await tx`select now() as now`;
      const nowMs = new Date(now).getTime();
      if (!c) throw notFound("Challenge not found");
      const type = c.challenge_type as ChallengeType;
      const winner = type === "FIRST_GLOBAL" ? await firstGlobalWinner(tx, c.id) : null;
      const state = challengeState({ ...c, has_winner: !!winner }, nowMs);

      if (state === "draft" || state === "scheduled" || state === "archived") throw notFound("Challenge not found");
      if (!c.accepts_submissions) throw conflict("This challenge doesn't take applications — the organizers decide it");
      if (state === "claimed") throw conflict(`Too late — this challenge was already claimed${winner ? ` by ${winner.name}` : ""}`);
      if (state === "finalized" || state === "locked") throw conflict("This challenge is locked");
      if (state === "expired") throw conflict("This challenge has expired");

      const [counts] = await tx`
        select
          count(*) filter (where status = 'pending')::int as pending,
          count(*) filter (where status = 'approved')::int as approved,
          coalesce(sum(awarded_units) filter (where status = 'approved'), 0)::int as units
        from challenge_submissions where challenge_id = ${c.id} and team_id = ${teamId}`;
      if (counts.pending > 0) throw conflict("You already have a pending application for this challenge");
      if ((type === "FIRST_GLOBAL" || type === "OPEN_ONCE") && counts.approved > 0) {
        throw conflict("Your team has already completed this challenge");
      }
      if (type === "REPEATABLE" && counts.units >= c.max_completions_per_team) {
        throw conflict(`Your team has reached the maximum of ${c.max_completions_per_team} awards for this challenge`);
      }

      const ev = (c.evidence_config ?? {}) as EvidenceConfig;
      if (ev.requireUrl && !url) throw badRequest("A link is required for this challenge");
      if (ev.numericRequired && numeric == null) throw badRequest(`Please enter: ${ev.numericLabel ?? "a number"}`);
      if (fileIds.length && ev.allowFiles === false) throw badRequest("This challenge takes a link instead of files");

      const [sub] = await tx`
        insert into challenge_submissions (challenge_id, team_id, description, evidence_url, numeric_value)
        values (${c.id}, ${teamId}, ${description}, ${url}, ${numeric})
        returning id, submitted_at`;
      if (fileIds.length) {
        await tx`update submission_files set submission_id = ${sub.id}, verified = true where id = any(${fileIds}::uuid[]) and team_id = ${teamId}`;
      }
      return { id: sub.id as string, submittedAt: new Date(sub.submitted_at).toISOString(), challenge: c.title as string };
    });
  } catch (e) {
    if (isUniqueViolation(e, "submissions_one_pending")) throw conflict("You already have a pending application for this challenge");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Organizer review
// ---------------------------------------------------------------------------
async function loadForReview(tx: Tx, submissionId: string) {
  const [ref] = await tx`select challenge_id from challenge_submissions where id = ${submissionId}`;
  if (!ref) throw notFound("Application not found");
  // Lock order everywhere: challenge row, then submission row.
  const c = await lockChallenge(tx, ref.challenge_id, "update");
  const [s] = await tx`
    select s.*, t.name as team_name from challenge_submissions s join teams t on t.id = s.team_id
    where s.id = ${submissionId} for update of s`;
  return { c, s };
}

export interface ApproveOptions { units?: number; verifiedValue?: number | null; note?: string | null }

export async function approveSubmission(submissionId: string, opts: ApproveOptions = {}) {
  return withTx(async (tx) => {
    const { c, s } = await loadForReview(tx, submissionId);
    if (s.status !== "pending") throw conflict(`This application was already ${s.status}`);
    const type = c.challenge_type as ChallengeType;
    let units = 0;

    if (type === "FIRST_GLOBAL") {
      const winner = await firstGlobalWinner(tx, c.id);
      if (winner) throw conflict(`Already claimed by ${winner.name}. Reject this application.`);
      const [earlier] = await tx`
        select s.id, s.submitted_at, t.name from challenge_submissions s join teams t on t.id = s.team_id
        where s.challenge_id = ${c.id} and s.status = 'pending' and s.id <> ${s.id}
          and (s.submitted_at, s.seq) < (${s.submitted_at}::timestamptz, ${s.seq}::bigint)
        order by s.submitted_at, s.seq limit 1`;
      if (earlier) {
        throw conflict(
          `Fairness check: ${earlier.name} applied earlier (${fmtTimeSec(earlier.submitted_at)}). Approve or reject their application first.`,
          { blockingSubmissionId: earlier.id },
        );
      }
      units = 1;
    } else if (type === "OPEN_ONCE") {
      const [done] = await tx`
        select 1 from challenge_submissions where challenge_id = ${c.id} and team_id = ${s.team_id} and status = 'approved' limit 1`;
      if (done) throw conflict(`${s.team_name} has already been awarded this challenge`);
      units = 1;
    } else if (type === "REPEATABLE") {
      const [{ used }] = await tx`
        select coalesce(sum(awarded_units), 0)::int as used from challenge_submissions
        where challenge_id = ${c.id} and team_id = ${s.team_id} and status = 'approved'`;
      const remaining = c.max_completions_per_team - used;
      if (remaining <= 0) throw conflict(`${s.team_name} already has the maximum ${c.max_completions_per_team} awards`);
      const want = opts.units ?? 1;
      if (!Number.isInteger(want) || want < 1) throw badRequest("Award count must be at least 1");
      if (want > remaining) throw conflict(`Only ${remaining} award(s) left for ${s.team_name} (cap ${c.max_completions_per_team})`);
      units = want;
    }
    // COMPETITIVE / JUDGED / VOTE: approval = verified/eligible. Points only at finalization.

    const verified = opts.verifiedValue == null || Number.isNaN(opts.verifiedValue) ? null : Number(opts.verifiedValue);
    await tx`
      update challenge_submissions
         set status = 'approved', reviewed_at = now(), awarded_units = ${units},
             verified_value = coalesce(${verified}::numeric, verified_value),
             review_note = ${opts.note?.trim() || null}
       where id = ${s.id}`;

    let awarded = 0;
    if (c.points !== 0) {
      for (let i = 1; i <= units; i++) {
        await insertLedger(tx, {
          teamId: s.team_id,
          challengeId: c.id,
          submissionId: s.id,
          delta: c.points,
          type: "challenge_award",
          reason: `${c.title} approved`,
          publicLabel: c.title,
          awardKey: `sub:${s.id}:${i}`,
        });
        awarded += c.points;
      }
    }

    let autoRejected = 0;
    if (type === "FIRST_GLOBAL") {
      const res = await tx`
        update challenge_submissions
           set status = 'rejected', reviewed_at = now(), review_note = ${`Claimed first by ${s.team_name}.`}
         where challenge_id = ${c.id} and status = 'pending'`;
      autoRejected = res.count;
    }

    await audit(tx, "submission.approved", {
      submissionId: s.id, challenge: c.title, team: s.team_name, type, units, points: awarded, autoRejected,
    });
    return { awarded, units, eligibleOnly: units === 0, team: s.team_name as string, challenge: c.title as string, autoRejected };
  });
}

export async function rejectSubmission(submissionId: string, note: string) {
  const reason = note?.trim() ?? "";
  if (reason.length < 3) throw badRequest("Please give the team a short reason");
  return withTx(async (tx) => {
    const { c, s } = await loadForReview(tx, submissionId);
    if (s.status !== "pending") throw conflict(`This application was already ${s.status}`);
    await tx`
      update challenge_submissions set status = 'rejected', reviewed_at = now(), review_note = ${reason.slice(0, 500)}
      where id = ${s.id}`;
    await audit(tx, "submission.rejected", { submissionId: s.id, challenge: c.title, team: s.team_name, reason });
    return { team: s.team_name as string, challenge: c.title as string };
  });
}

/** Undo an approval: compensating ledger entries + mark rejected. Reopens a FIRST_GLOBAL claim. */
export async function revokeApproval(submissionId: string, note: string) {
  const reason = note?.trim() ?? "";
  if (reason.length < 3) throw badRequest("A reason is required to revoke an approval");
  return withTx(async (tx) => {
    const { c, s } = await loadForReview(tx, submissionId);
    if (s.status !== "approved") throw conflict("Only approved applications can be revoked");
    const entries = await tx`
      select l.id, l.points_delta from score_ledger l
      where l.submission_id = ${s.id} and l.entry_type = 'challenge_award'
        and not exists (select 1 from score_ledger r where r.reverses_id = l.id)`;
    let reversed = 0;
    for (const e of entries) {
      await insertLedger(tx, {
        teamId: s.team_id, challengeId: c.id, submissionId: s.id, delta: -Number(e.points_delta),
        type: "reversal", reason: `Approval revoked: ${reason}`, publicLabel: "Organizer correction", reversesId: Number(e.id),
      });
      reversed += Number(e.points_delta);
    }
    await tx`
      update challenge_submissions set status = 'rejected', reviewed_at = now(), review_note = ${`Approval revoked: ${reason}`.slice(0, 500)}
      where id = ${s.id}`;
    await audit(tx, "submission.revoked", { submissionId: s.id, challenge: c.title, team: s.team_name, pointsReversed: reversed, reason });
    return { pointsReversed: reversed };
  });
}

export async function setVerifiedValue(submissionId: string, value: number | null) {
  return withTx(async (tx) => {
    const [s] = await tx`update challenge_submissions set verified_value = ${value} where id = ${submissionId} returning id`;
    if (!s) throw notFound("Application not found");
    await audit(tx, "submission.verified_value", { submissionId, value });
  });
}
