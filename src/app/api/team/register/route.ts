import { z } from "zod";
import { clientIp, json, readJson, route } from "@/lib/server/http";
import { setTeamCookie } from "@/lib/server/session";
import { invalidatePublicCache } from "@/lib/server/state";
import { registerTeam } from "@/lib/server/teams";

const body = z.object({
  name: z.string().max(60),
  participants: z.union([z.array(z.string().max(80)).max(20), z.string().max(2000)]),
});

// Self-service team creation. Codes are returned ONCE in this response and never stored in plaintext.
export const POST = route(async (req) => {
  const input = body.parse(await readJson(req));
  const card = await registerTeam(input, clientIp(req));
  invalidatePublicCache();
  const res = json({
    ok: true,
    team: card.team,
    accessCode: card.accessCode,
    participants: card.participants.map((p) => ({ name: p.name, voteCode: p.voteCode })),
  });
  setTeamCookie(res, card.team.id, card.sessionVersion);
  return res;
});
