import { z } from "zod";
import { readJson, route } from "@/lib/server/http";
import { requireTeam } from "@/lib/server/session";
import { submitApplication } from "@/lib/server/submissions";
import { invalidatePublicCache } from "@/lib/server/state";

const body = z.object({
  challengeId: z.string().uuid(),
  description: z.string().max(2000),
  evidenceUrl: z.string().max(1000).nullable().optional(),
  numericValue: z.number().finite().nullable().optional(),
  fileIds: z.array(z.string().uuid()).max(3).optional(),
});

export const POST = route(async (req) => {
  // Team identity comes ONLY from the signed session cookie — never from the body.
  const team = await requireTeam(req);
  const input = body.parse(await readJson(req));
  const res = await submitApplication(team.teamId, input);
  invalidatePublicCache();
  return { ok: true, submission: res };
});
