import { z } from "zod";
import { clientIp, json, readJson, route } from "@/lib/server/http";
import { setTeamCookie } from "@/lib/server/session";
import { loginTeam } from "@/lib/server/teams";

const body = z.object({ teamId: z.string().uuid("Pick your team"), code: z.string().min(4).max(40) });

export const POST = route(async (req) => {
  const { teamId, code } = body.parse(await readJson(req));
  const t = await loginTeam(teamId, code, clientIp(req));
  const res = json({ ok: true, team: { id: t.teamId, name: t.name } });
  setTeamCookie(res, t.teamId, t.sessionVersion);
  return res;
});
