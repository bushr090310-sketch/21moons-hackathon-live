import { z } from "zod";
import { AppError, badRequest } from "@/lib/server/errors";
import { safeEqual } from "@/lib/server/crypto";
import { clientIp, json, readJson, route } from "@/lib/server/http";
import { assertNotThrottled, recordFailure } from "@/lib/server/ratelimit";
import { setAdminCookie } from "@/lib/server/session";

const body = z.object({ password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new AppError(503, "ADMIN_PASSWORD is not configured on the server.");
  const ip = clientIp(req);
  await assertNotThrottled("admin-login", ip, 10);
  const { password } = body.parse(await readJson(req));
  if (!safeEqual(password, expected)) {
    await recordFailure("admin-login", ip);
    throw badRequest("Wrong password");
  }
  const res = json({ ok: true });
  setAdminCookie(res);
  return res;
});
