import { db } from "./db";
import { computeLeaderboard } from "./scoring";

/** Full event record for backup. Never includes code hashes or file contents. */
export async function exportEvent() {
  const sql = db();
  const [settings] = await sql`select event_name, event_location, event_starts_at, event_ends_at, sponsors, leaderboard_frozen, frozen_at, revealed_at, voting_state, submissions_open from event_settings where id = 1`;
  const teams = await sql`select id, name, slug, description, active, is_demo, score_cached, created_at from teams order by name`;
  const participants = await sql`select p.id, p.team_id, t.name as team_name, p.name, p.created_at from participants p join teams t on t.id = p.team_id order by t.name, p.created_at`;
  const challenges = await sql`select id, slug, emoji, title, points, challenge_type, award_mode, status, reveal_at, expires_at, is_secret, max_completions_per_team, accepts_submissions, finalized_at, short_description, full_description from challenges order by sort_order`;
  const submissions = await sql`
    select s.id, s.challenge_id, c.title as challenge, s.team_id, t.name as team, s.status, s.description, s.evidence_url,
           s.numeric_value, s.verified_value, s.submitted_at, s.reviewed_at, s.review_note, s.awarded_units,
           (select count(*)::int from submission_files f where f.submission_id = s.id) as file_count
    from challenge_submissions s join teams t on t.id = s.team_id join challenges c on c.id = s.challenge_id order by s.submitted_at`;
  const ledger = await sql`
    select l.id, l.team_id, t.name as team, l.challenge_id, l.submission_id, l.points_delta, l.entry_type, l.reason, l.public_label, l.reverses_id, l.created_at
    from score_ledger l join teams t on t.id = l.team_id order by l.id`;
  const voteCounts = await sql`select t.name as team, count(v.id)::int as votes from teams t left join votes v on v.voted_team_id = t.id group by t.id order by votes desc`;
  const votes = await sql`select p.name as voter, pt.name as voter_team, t.name as voted_for, v.created_at from votes v join participants p on p.id = v.participant_id join teams pt on pt.id = p.team_id join teams t on t.id = v.voted_team_id order by v.created_at`;
  const auditLog = await sql`select id, action, details, created_at from admin_audit_log order by id`;
  const finalScores = await computeLeaderboard(sql, null);
  return {
    exportedAt: new Date().toISOString(),
    settings, finalScores, teams, participants, challenges, submissions, ledger,
    votes: { counts: voteCounts, ballots: votes }, auditLog,
  };
}

export const EXPORT_DATASETS = ["final_scores", "teams", "participants", "challenges", "submissions", "ledger", "votes"] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}

export async function exportCsv(dataset: (typeof EXPORT_DATASETS)[number]) {
  const all = await exportEvent();
  const map: Record<string, Record<string, unknown>[]> = {
    final_scores: all.finalScores.map((r) => ({ rank: r.rank, team: r.name, score: r.score, completed: r.completed, reached_at: r.reachedAt })),
    teams: all.teams as unknown as Record<string, unknown>[],
    participants: all.participants as unknown as Record<string, unknown>[],
    challenges: all.challenges as unknown as Record<string, unknown>[],
    submissions: all.submissions as unknown as Record<string, unknown>[],
    ledger: all.ledger as unknown as Record<string, unknown>[],
    votes: all.votes.counts as unknown as Record<string, unknown>[],
  };
  return toCsv(map[dataset]);
}
