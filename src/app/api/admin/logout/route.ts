import { json, route } from "@/lib/server/http";
import { ADMIN_COOKIE, clearCookie } from "@/lib/server/session";

export const POST = route(async () => {
  const res = json({ ok: true });
  clearCookie(res, ADMIN_COOKIE);
  return res;
});
