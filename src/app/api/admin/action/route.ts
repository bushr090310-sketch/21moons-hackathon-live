import { z } from "zod";
import { readJson, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { withTx } from "@/lib/server/db";
import { badRequest } from "@/lib/server/errors";
import { invalidatePublicCache } from "@/lib/server/state";
import { approveSubmission, rejectSubmission, revokeApproval, setVerifiedValue } from "@/lib/server/submissions";
import { challengeCommand, challengeInput, createChallenge, finalizeChallengeTx, updateChallenge } from "@/lib/server/challenges";
import { manualAdjustment, reverseLedgerEntry } from "@/lib/server/scoring";
import {
  addParticipants, createTeam, regenerateTeamCode, regenerateVoteCodes, removeDemoTeams, removeParticipant,
  renameParticipant, seedDemoTeams, updateTeam,
} from "@/lib/server/teams";
import { finalizePeoplesChoice, setVotingState } from "@/lib/server/voting";
import { freezeLeaderboard, revealLeaderboard, unfreezeLeaderboard, updateSettings } from "@/lib/server/settings";

const uuid = z.string().uuid();
const names = z.union([z.array(z.string().max(80)).max(20), z.string().max(2000)]);

const action = z.discriminatedUnion("action", [
  // Applications
  z.object({ action: z.literal("submission.approve"), id: uuid, units: z.number().int().min(1).max(100).optional(), verifiedValue: z.number().finite().nullable().optional(), note: z.string().max(500).nullable().optional() }),
  z.object({ action: z.literal("submission.reject"), id: uuid, note: z.string().max(500) }),
  z.object({ action: z.literal("submission.revoke"), id: uuid, note: z.string().max(500) }),
  z.object({ action: z.literal("submission.verify_value"), id: uuid, value: z.number().finite().nullable() }),
  // Challenges
  z.object({ action: z.literal("challenge.create"), data: challengeInput }),
  z.object({ action: z.literal("challenge.update"), id: uuid, data: challengeInput }),
  z.object({ action: z.literal("challenge.command"), id: uuid, command: z.enum(["activate", "hide", "lock", "unlock", "archive", "duplicate", "reopen"]) }),
  z.object({ action: z.literal("challenge.finalize"), id: uuid, winnerTeamIds: z.array(uuid).min(1).max(50), points: z.number().int().min(-1000).max(1000).optional(), note: z.string().max(200).optional() }),
  // Teams
  z.object({ action: z.literal("team.create"), name: z.string().max(60), description: z.string().max(280).nullable().optional(), participants: names }),
  z.object({ action: z.literal("team.update"), id: uuid, name: z.string().max(60).optional(), description: z.string().max(280).nullable().optional(), active: z.boolean().optional() }),
  z.object({ action: z.literal("team.regenerate_code"), id: uuid }),
  z.object({ action: z.literal("team.add_participants"), id: uuid, participants: names }),
  z.object({ action: z.literal("participant.rename"), id: uuid, name: z.string().max(80) }),
  z.object({ action: z.literal("participant.remove"), id: uuid }),
  z.object({ action: z.literal("vote_codes.regenerate"), teamId: uuid.optional(), participantId: uuid.optional(), all: z.boolean().optional() }),
  z.object({ action: z.literal("demo.seed") }),
  z.object({ action: z.literal("demo.remove") }),
  // Scores
  z.object({ action: z.literal("score.adjust"), teamId: uuid, delta: z.number().int(), reason: z.string().max(500), publicLabel: z.string().max(120).optional() }),
  z.object({ action: z.literal("score.reverse"), ledgerId: z.number().int().positive(), reason: z.string().max(500) }),
  // Leaderboard
  z.object({ action: z.literal("leaderboard.freeze") }),
  z.object({ action: z.literal("leaderboard.reveal") }),
  z.object({ action: z.literal("leaderboard.unfreeze") }),
  // Voting
  z.object({ action: z.literal("voting.set"), state: z.enum(["not_open", "open", "closed"]) }),
  z.object({ action: z.literal("voting.finalize"), challengeId: uuid.optional(), mode: z.enum(["auto", "co_winners", "runoff_winner"]).default("auto"), winnerTeamIds: z.array(uuid).optional() }),
  // Settings
  z.object({
    action: z.literal("settings.update"),
    submissionsOpen: z.boolean().optional(), teamRegistrationOpen: z.boolean().optional(), votingResultsPublic: z.boolean().optional(), showFirstGlobalWinner: z.boolean().optional(),
    sponsors: z.array(z.string().max(40)).max(30).optional(), announcement: z.string().max(200).nullable().optional(), eventName: z.string().max(80).optional(),
  }),
]);

export const POST = route(async (req) => {
  requireAdmin(req);
  const a = action.parse(await readJson(req));
  const result = await run(a);
  invalidatePublicCache();
  return { ok: true, result: result ?? null };
});

async function run(a: z.infer<typeof action>) {
  switch (a.action) {
    case "submission.approve": return approveSubmission(a.id, { units: a.units, verifiedValue: a.verifiedValue, note: a.note });
    case "submission.reject": return rejectSubmission(a.id, a.note);
    case "submission.revoke": return revokeApproval(a.id, a.note);
    case "submission.verify_value": return setVerifiedValue(a.id, a.value);
    case "challenge.create": return createChallenge(a.data);
    case "challenge.update": return updateChallenge(a.id, a.data);
    case "challenge.command": return challengeCommand(a.id, a.command);
    case "challenge.finalize": return finalizeChallengeTx({ challengeId: a.id, winnerTeamIds: a.winnerTeamIds, points: a.points, note: a.note });
    case "team.create": return createTeam({ name: a.name, description: a.description, participants: a.participants });
    case "team.update": return updateTeam(a.id, a);
    case "team.regenerate_code": return regenerateTeamCode(a.id);
    case "team.add_participants": return addParticipants(a.id, a.participants);
    case "participant.rename": return renameParticipant(a.id, a.name);
    case "participant.remove": return removeParticipant(a.id);
    case "vote_codes.regenerate":
      if (!a.teamId && !a.participantId && !a.all) throw badRequest("Specify a team, participant or all");
      return regenerateVoteCodes(a);
    case "demo.seed": return seedDemoTeams();
    case "demo.remove": return removeDemoTeams();
    case "score.adjust": return withTx((tx) => manualAdjustment(tx, a));
    case "score.reverse": return withTx((tx) => reverseLedgerEntry(tx, a.ledgerId, a.reason));
    case "leaderboard.freeze": return freezeLeaderboard();
    case "leaderboard.reveal": return revealLeaderboard();
    case "leaderboard.unfreeze": return unfreezeLeaderboard();
    case "voting.set": return setVotingState(a.state);
    case "voting.finalize": return finalizePeoplesChoice(a);
    case "settings.update": {
      const { action: _ignored, ...patch } = a;
      void _ignored;
      return updateSettings(patch);
    }
  }
}
