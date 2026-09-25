import { z } from "zod";
import { clientIp, readJson, route } from "@/lib/server/http";
import { voterStatus } from "@/lib/server/voting";

const body = z.object({ code: z.string().min(1).max(40) });
export const POST = route(async (req) => voterStatus(body.parse(await readJson(req)).code, clientIp(req)));
