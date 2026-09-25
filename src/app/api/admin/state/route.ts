import { route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { getAdminState } from "@/lib/server/state";

export const dynamic = "force-dynamic";
export const GET = route(async (req) => {
  requireAdmin(req);
  return getAdminState();
});
