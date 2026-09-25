import { z } from "zod";
import { clientIp, readJson, route } from "@/lib/server/http";
import { castVote } from "@/lib/server/voting";

const body = z.object({ code: z.string().min(1).max(40), teamId: z.string().uuid() });
export const POST = route(async (req) => {
  const { code, teamId } = body.parse(await readJson(req));
  return castVote(code, teamId, clientIp(req));
});
