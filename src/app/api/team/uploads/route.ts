import { z } from "zod";
import { readJson, route } from "@/lib/server/http";
import { requireTeam } from "@/lib/server/session";
import { createUploadSlot } from "@/lib/server/submissions";

const body = z.object({ name: z.string().max(200), mime: z.string().max(100), size: z.number().int() });

export const POST = route(async (req) => {
  const team = await requireTeam(req);
  return createUploadSlot(team.teamId, body.parse(await readJson(req)));
});
