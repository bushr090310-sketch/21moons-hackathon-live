import { json, route } from "@/lib/server/http";
import { TEAM_COOKIE, clearCookie } from "@/lib/server/session";

export const POST = route(async () => {
  const res = json({ ok: true });
  clearCookie(res, TEAM_COOKIE);
  return res;
});
