import { z } from "zod";
import { COSMIC_KINDS, POWER_TYPES, type CosmicKind, type PowerType } from "@/lib/shared/universe";
import { readJson, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { invalidatePublicCache } from "@/lib/server/state";
import { adminGrantPower, revokePower, setChallengeReward } from "@/lib/server/universe/powers";
import { createDraft, dismissEvent, endEvent, goLive } from "@/lib/server/universe/cosmic";
import { runTick } from "@/lib/server/universe/tick";
import {
  archiveNews, getUniverseAdmin, invalidateUniverseCache, publishBroadcast, updateUniverseSettings,
} from "@/lib/server/universe/state";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  requireAdmin(req);
  return getUniverseAdmin();
});

const uuid = z.string().uuid();
const power = z.enum(POWER_TYPES as [PowerType, ...PowerType[]]);
const kind = z.enum(COSMIC_KINDS as [CosmicKind, ...CosmicKind[]]);

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), enabled: z.boolean().optional(), autoNews: z.boolean().optional(), oneToWatchTeamId: uuid.nullable().optional() }),
  z.object({ action: z.literal("news.publish"), headline: z.string().max(140), body: z.string().max(400).nullable().optional(), importance: z.enum(["normal", "hot", "breaking"]), teamId: uuid.nullable().optional(), emoji: z.string().max(16).optional() }),
  z.object({ action: z.literal("news.archive"), id: z.number().int().positive() }),
  z.object({ action: z.literal("power.grant"), teamId: uuid, type: power, note: z.string().max(200).optional() }),
  z.object({ action: z.literal("power.revoke"), id: uuid, reason: z.string().max(200) }),
  z.object({ action: z.literal("reward.set"), challengeId: uuid, type: power.nullable() }),
  z.object({ action: z.literal("cosmic.draft"), kind, title: z.string().max(80).optional(), explanation: z.string().max(300).optional(), durationMinutes: z.number().int().min(1).max(240).nullable().optional(), points: z.number().int().min(0).max(1000).nullable().optional() }),
  z.object({ action: z.literal("cosmic.dismiss"), id: uuid }),
  z.object({
    action: z.literal("cosmic.go_live"), id: uuid, buildupSeconds: z.number().int(), durationMinutes: z.number().int().min(1).max(240).nullable().optional(),
    points: z.number().int().min(0).max(1000).nullable().optional(), title: z.string().max(80).optional(), explanation: z.string().max(300).optional(), linkedChallengeId: uuid.nullable().optional(),
  }),
  z.object({ action: z.literal("cosmic.end"), id: uuid, cancel: z.boolean().optional() }),
  z.object({ action: z.literal("tick") }),
]);

export const POST = route(async (req) => {
  requireAdmin(req);
  const a = action.parse(await readJson(req));
  let result: unknown = null;
  switch (a.action) {
    case "settings": result = await updateUniverseSettings(a); break;
    case "news.publish": result = await publishBroadcast(a); break;
    case "news.archive": result = await archiveNews(a.id); break;
    case "power.grant": result = await adminGrantPower(a.teamId, a.type, a.note); break;
    case "power.revoke": result = await revokePower(a.id, a.reason); break;
    case "reward.set": result = await setChallengeReward(a.challengeId, a.type); break;
    case "cosmic.draft": result = await createDraft(a); break;
    case "cosmic.dismiss": result = await dismissEvent(a.id); break;
    case "cosmic.go_live": result = await goLive(a.id, a); break;
    case "cosmic.end": result = await endEvent(a.id, !!a.cancel); break;
    case "tick": result = await runTick({ force: true }); break;
  }
  invalidateUniverseCache();
  invalidatePublicCache();
  return { ok: true, result };
});
