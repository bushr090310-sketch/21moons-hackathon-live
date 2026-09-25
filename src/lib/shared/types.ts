export type ChallengeType = "FIRST_GLOBAL" | "OPEN_ONCE" | "REPEATABLE" | "COMPETITIVE" | "JUDGED" | "VOTE";
export type ChallengeStatus = "draft" | "scheduled" | "live" | "locked" | "archived";
export type SubmissionStatus = "pending" | "approved" | "rejected";
/** Effective state shown in the UI. */
export type ChallengeState = "draft" | "scheduled" | "active" | "claimed" | "finalized" | "locked" | "expired" | "archived";
export type VotingState = "not_open" | "open" | "closed";

export const CHALLENGE_TYPES: ChallengeType[] = ["FIRST_GLOBAL", "OPEN_ONCE", "REPEATABLE", "COMPETITIVE", "JUDGED", "VOTE"];

export const TYPE_LABEL: Record<ChallengeType, string> = {
  FIRST_GLOBAL: "First team wins",
  OPEN_ONCE: "Every team, once",
  REPEATABLE: "Repeatable",
  COMPETITIVE: "Competitive",
  JUDGED: "Jury decides",
  VOTE: "People's vote",
};

export interface EvidenceConfig {
  requireUrl?: boolean;
  allowFiles?: boolean;
  numericLabel?: string | null;
  numericRequired?: boolean;
  hint?: string;
}

export interface LeaderboardRow {
  teamId: string;
  name: string;
  score: number;
  rank: number;
  reachedAt: string | null;
  lastDelta: number | null;
  lastDeltaAt: string | null;
  lastLabel: string | null;
  completed: number;
}

export interface ActivityItem {
  id: string;
  teamName: string;
  delta: number;
  label: string;
  emoji: string | null;
  at: string;
}

export interface PublicChallenge {
  id: string;
  slug: string;
  emoji: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
  points: number;
  type: ChallengeType;
  state: ChallengeState;
  revealAt: string | null;
  expiresAt: string | null;
  acceptsSubmissions: boolean;
  maxCompletions: number;
  evidence: EvidenceConfig;
  sensitive: boolean;
  claimedBy: string | null;
  winners: string[];
  resultsHidden: boolean;
  sortOrder: number;
}

export interface PublicEvent {
  name: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  frozen: boolean;
  frozenAt: string | null;
  revealedAt: string | null;
  votingState: VotingState;
  submissionsOpen: boolean;
  sponsors: string[];
  announcement: string | null;
}

export interface PublicState {
  serverTime: string;
  event: PublicEvent;
  leaderboard: LeaderboardRow[];
  activity: ActivityItem[];
  challenges: PublicChallenge[];
  nextDropAt: string | null;
  voteResults: { teamId: string; name: string; votes: number }[] | null;
}
