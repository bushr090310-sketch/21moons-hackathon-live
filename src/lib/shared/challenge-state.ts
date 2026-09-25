import type { ChallengeState, ChallengeStatus, ChallengeType } from "./types";

export interface StateInput {
  status: ChallengeStatus;
  challenge_type: ChallengeType;
  reveal_at: Date | string | null;
  expires_at: Date | string | null;
  finalized_at: Date | string | null;
  has_winner?: boolean;
}

const t = (v: Date | string | null) => (v == null ? null : new Date(v).getTime());

export function isRevealed(c: Pick<StateInput, "status" | "reveal_at">, now: number): boolean {
  if (c.status === "live" || c.status === "locked") return true;
  if (c.status === "scheduled") {
    const r = t(c.reveal_at);
    return r != null && r <= now;
  }
  return false;
}

export function challengeState(c: StateInput, now: number): ChallengeState {
  if (c.status === "archived") return "archived";
  if (c.status === "draft") return "draft";
  if (!isRevealed(c, now)) return "scheduled";
  if (c.challenge_type === "FIRST_GLOBAL" && c.has_winner) return "claimed";
  if (c.finalized_at) return "finalized";
  if (c.status === "locked") return "locked";
  const e = t(c.expires_at);
  if (e != null && e <= now) return "expired";
  return "active";
}

export const STATE_LABEL: Record<ChallengeState, string> = {
  draft: "DRAFT",
  scheduled: "SCHEDULED",
  active: "ACTIVE",
  claimed: "CLAIMED",
  finalized: "FINALIZED",
  locked: "LOCKED",
  expired: "EXPIRED",
  archived: "ARCHIVED",
};

export function awardModeFor(type: ChallengeType): "on_approval" | "on_finalize" | "on_vote" {
  if (type === "VOTE") return "on_vote";
  if (type === "COMPETITIVE" || type === "JUDGED") return "on_finalize";
  return "on_approval";
}
