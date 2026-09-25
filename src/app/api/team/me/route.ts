import { json, route } from "@/lib/server/http";
import { getTeamSession } from "@/lib/server/session";
import { getTeamState } from "@/lib/server/state";

export const dynamic = "force-dynamic";
export const GET = route(async (req) => {
  const s = await getTeamSession(req);
  if (!s) return json({ error: "Team login required" }, 401);
  return getTeamState(s.teamId);
});
