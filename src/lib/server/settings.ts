import { withTx } from "./db";
import { badRequest } from "./errors";
import { audit } from "./audit";

export async function freezeLeaderboard() {
  return withTx(async (tx) => {
    const [s] = await tx`select leaderboard_frozen from event_settings where id = 1 for update`;
    if (s.leaderboard_frozen) return { alreadyFrozen: true };
    await tx`update event_settings set leaderboard_frozen = true, frozen_at = now(), revealed_at = null, updated_at = now() where id = 1`;
    await audit(tx, "leaderboard.frozen", {});
    return { alreadyFrozen: false };
  });
}

export async function revealLeaderboard() {
  return withTx(async (tx) => {
    const [s] = await tx`select leaderboard_frozen from event_settings where id = 1 for update`;
    if (!s.leaderboard_frozen) throw badRequest("The public leaderboard is not frozen");
    await tx`update event_settings set leaderboard_frozen = false, revealed_at = now(), updated_at = now() where id = 1`;
    await audit(tx, "leaderboard.revealed", {});
  });
}

/** Unfreeze quietly (e.g. frozen by mistake) — no "final reveal" animation. */
export async function unfreezeLeaderboard() {
  return withTx(async (tx) => {
    await tx`update event_settings set leaderboard_frozen = false, frozen_at = null, updated_at = now() where id = 1`;
    await audit(tx, "leaderboard.unfrozen", {});
  });
}

export interface SettingsPatch {
  submissionsOpen?: boolean;
  teamRegistrationOpen?: boolean;
  votingResultsPublic?: boolean;
  showFirstGlobalWinner?: boolean;
  sponsors?: string[];
  announcement?: string | null;
  eventName?: string;
}

export async function updateSettings(p: SettingsPatch) {
  if (p.sponsors) {
    p.sponsors = p.sponsors.map((s) => s.trim()).filter(Boolean).slice(0, 30);
    if (p.sponsors.some((s) => s.length > 40)) throw badRequest("Sponsor names must be 40 characters or less");
  }
  if (p.announcement != null && p.announcement.length > 200) throw badRequest("Announcement max 200 characters");
  return withTx(async (tx) => {
    await tx`
      update event_settings set
        submissions_open = coalesce(${p.submissionsOpen ?? null}::boolean, submissions_open),
        team_registration_open = coalesce(${p.teamRegistrationOpen ?? null}::boolean, team_registration_open),
        voting_results_public = coalesce(${p.votingResultsPublic ?? null}::boolean, voting_results_public),
        show_first_global_winner = coalesce(${p.showFirstGlobalWinner ?? null}::boolean, show_first_global_winner),
        sponsors = coalesce(${p.sponsors ? tx.json(p.sponsors) : null}::jsonb, sponsors),
        announcement = case when ${p.announcement !== undefined} then ${p.announcement?.trim() || null} else announcement end,
        event_name = coalesce(${p.eventName?.trim() || null}, event_name),
        updated_at = now()
      where id = 1`;
    if (p.teamRegistrationOpen !== undefined) {
      await audit(tx, p.teamRegistrationOpen ? "team_registration.opened" : "team_registration.closed", {});
    }
    await audit(tx, "settings.updated", p as Record<string, unknown>);
  });
}
