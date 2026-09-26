// 21MOONS UNIVERSE — pure, deterministic logic shared by server and client.
// Nothing here touches scoring; everything is derived or presentational.

// ---------------------------------------------------------------------------
// Cosmic powers (backend ids stay technical; names are for participants)
// ---------------------------------------------------------------------------
export type PowerType = "SABOTAGE_5" | "SABOTAGE_10" | "SHIELD";
export const POWER_TYPES: PowerType[] = ["SABOTAGE_5", "SABOTAGE_10", "SHIELD"];

export const POWERS: Record<PowerType, { emoji: string; name: string; does: string; value: number }> = {
  SABOTAGE_5: { emoji: "☄️", name: "Meteor Strike", does: "Remove 5 pts from another Moon", value: 5 },
  SABOTAGE_10: { emoji: "🌑", name: "Moonstrike", does: "Remove 10 pts from another Moon", value: 10 },
  SHIELD: { emoji: "🛡️", name: "Force Field", does: "Blocks your next incoming attack", value: 0 },
};

/** Never push a score below zero. */
export function attackDelta(requested: number, targetScore: number): number {
  return Math.max(0, Math.min(requested, Math.max(0, targetScore)));
}

// ---------------------------------------------------------------------------
// Team cosmic status — derived, never affects score. One status per team.
// ---------------------------------------------------------------------------
export type StatusCode = "FULL_MOON" | "ONE_TO_WATCH" | "SUPERNOVA" | "LIFTOFF" | "IN_ORBIT" | "DARK_SIDE";

export const STATUS_META: Record<StatusCode, { emoji: string; label: string; means: string }> = {
  FULL_MOON: { emoji: "🌕", label: "Full Moon", means: "#1 on the leaderboard" },
  ONE_TO_WATCH: { emoji: "🔭", label: "One to watch", means: "Picked by the organizers" },
  SUPERNOVA: { emoji: "☀️", label: "Supernova", means: "Scoring fast" },
  LIFTOFF: { emoji: "🚀", label: "Liftoff", means: "Climbing fast" },
  IN_ORBIT: { emoji: "🛰️", label: "In orbit", means: "Closing in on the lead" },
  DARK_SIDE: { emoji: "🌑", label: "Dark side", means: "Quiet recently" },
};

export const STATUS_RULES = {
  supernovaPts: 30, // pts gained in the last 60 min
  liftoffPlaces: 2, // rank places gained vs 30 min ago
  inOrbitGap: 15, // pts behind the leader (ranks 2–3)
  darkSideMinutes: 45, // no pts for this long (only teams that have scored)
};

export interface StatusInput {
  teamId: string;
  rank: number;
  score: number;
  gainedLastHour: number;
  rankThirtyMinAgo: number | null;
  lastScoredAt: string | null;
}

export interface TeamStatus { code: StatusCode; emoji: string; label: string; detail: string }

export function deriveStatuses(rows: StatusInput[], now: number, oneToWatch: string | null): Record<string, TeamStatus> {
  const out: Record<string, TeamStatus> = {};
  const leader = rows.find((r) => r.rank === 1);
  const make = (code: StatusCode, detail?: string): TeamStatus => ({ code, emoji: STATUS_META[code].emoji, label: STATUS_META[code].label, detail: detail ?? STATUS_META[code].means });
  for (const r of rows) {
    if (r.rank === 1 && r.score > 0) { out[r.teamId] = make("FULL_MOON"); continue; }
    if (oneToWatch && r.teamId === oneToWatch) { out[r.teamId] = make("ONE_TO_WATCH"); continue; }
    if (r.gainedLastHour >= STATUS_RULES.supernovaPts) { out[r.teamId] = make("SUPERNOVA", `+${r.gainedLastHour} pts in the last hour`); continue; }
    if (r.rankThirtyMinAgo != null && r.rankThirtyMinAgo - r.rank >= STATUS_RULES.liftoffPlaces && r.score > 0) {
      out[r.teamId] = make("LIFTOFF", `Up ${r.rankThirtyMinAgo - r.rank} places`);
      continue;
    }
    if (leader && leader.score > 0 && (r.rank === 2 || r.rank === 3) && r.score > 0 && leader.score - r.score <= STATUS_RULES.inOrbitGap) {
      out[r.teamId] = make("IN_ORBIT", `${leader.score - r.score} pts behind the lead`);
      continue;
    }
    if (r.score > 0 && r.lastScoredAt && now - new Date(r.lastScoredAt).getTime() >= STATUS_RULES.darkSideMinutes * 60_000) {
      out[r.teamId] = make("DARK_SIDE");
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cosmic events catalog — plain explanations first.
// ---------------------------------------------------------------------------
export type CosmicKind = "ECLIPSE" | "SOLAR_FLARE" | "BLACK_HOLE" | "WORMHOLE" | "ANOMALY" | "HUNT_THE_LEADER" | "CONTENT_STORM";
export const COSMIC_KINDS: CosmicKind[] = ["ECLIPSE", "SOLAR_FLARE", "BLACK_HOLE", "WORMHOLE", "ANOMALY", "HUNT_THE_LEADER", "CONTENT_STORM"];

export const COSMIC: Record<CosmicKind, { emoji: string; title: string; explanation: string }> = {
  ECLIPSE: { emoji: "🌘", title: "Eclipse", explanation: "Public score numbers are hidden for a while. Scoring continues normally." },
  SOLAR_FLARE: { emoji: "☀️", title: "Solar Flare", explanation: "A short high-speed challenge appears." },
  BLACK_HOLE: { emoji: "🕳️", title: "Black Hole", explanation: "A major limited-time challenge appears." },
  WORMHOLE: { emoji: "🌌", title: "Wormhole", explanation: "A surprise challenge drop is coming." },
  ANOMALY: { emoji: "⚠️", title: "Cosmic Anomaly", explanation: "Something is about to happen." },
  HUNT_THE_LEADER: { emoji: "🎯", title: "Hunt the Leader", explanation: "A bounty challenge targets the #1 Moon." },
  CONTENT_STORM: { emoji: "📣", title: "Content Storm", explanation: "A quick content mini-challenge appears." },
};

export const BUILDUP_OPTIONS = [0, 30, 60, 180, 300] as const;

export type CosmicPhase = "none" | "buildup" | "active" | "over";

export interface CosmicTiming { status: string; goesLiveAt: string | null; endsAt: string | null }

/** Where a LIVE cosmic event is in its lifecycle. Only admin-approved (status=live) events ever have a phase. */
export function cosmicPhase(e: CosmicTiming | null, now: number): CosmicPhase {
  if (!e || e.status !== "live" || !e.goesLiveAt) return "none";
  const start = new Date(e.goesLiveAt).getTime();
  if (now < start) return "buildup";
  if (e.endsAt && now >= new Date(e.endsAt).getTime()) return "over";
  return "active";
}

// ---------------------------------------------------------------------------
// Projector takeover queue
// ---------------------------------------------------------------------------
export interface TakeoverItem { id: string; createdAt: string; importance: "normal" | "hot" | "breaking" }

export const TAKEOVER_MAX_AGE_MS = 120_000;
export const TAKEOVER_SHOW_MS = 6500;

/**
 * Oldest-first queue of takeovers not yet shown on this screen and still fresh.
 * Fresh + seen-set means reconnects/refreshes never replay old takeovers.
 */
export function buildTakeoverQueue<T extends TakeoverItem>(items: T[], seen: Set<string>, now: number, maxAgeMs = TAKEOVER_MAX_AGE_MS): T[] {
  return items
    .filter((i) => !seen.has(i.id) && now - new Date(i.createdAt).getTime() <= maxAgeMs)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || Number(a.id) - Number(b.id));
}

// ---------------------------------------------------------------------------
// Relative time for the feed: NOW, 2m, 14m, 1h
// ---------------------------------------------------------------------------
export function relTime(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "NOW";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
