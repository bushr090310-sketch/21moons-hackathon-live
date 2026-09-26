import { z } from "zod";
import { readJson, route } from "@/lib/server/http";
import { requireTeam } from "@/lib/server/session";
import { invalidatePublicCache } from "@/lib/server/state";
import { usePower } from "@/lib/server/universe/powers";
import { invalidateUniverseCache } from "@/lib/server/universe/state";

const body = z.object({ powerupId: z.string().uuid(), targetTeamId: z.string().uuid(), requestId: z.string().min(8).max(80) });

// Attacker identity comes ONLY from the signed team session.
export const POST = route(async (req) => {
  const team = await requireTeam(req);
  const input = body.parse(await readJson(req));
  const result = await usePower(team.teamId, input);
  invalidatePublicCache();
  invalidateUniverseCache();
  return { ok: true, result };
});
