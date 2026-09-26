import { json, route } from "@/lib/server/http";
import { getTeamSession } from "@/lib/server/session";
import { getUniverseTeam } from "@/lib/server/universe/state";

export const dynamic = "force-dynamic";
export const GET = route(async (req) => {
  const s = await getTeamSession(req);
  if (!s) return json({ error: "Team login required" }, 401);
  try {
    return await getUniverseTeam(s.teamId);
  } catch (e) {
    console.error("[universe team]", (e as Error).message);
    return { enabled: false };
  }
});
