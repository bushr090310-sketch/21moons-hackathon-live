import { route } from "@/lib/server/http";
import { getHealth } from "@/lib/server/state";

export const dynamic = "force-dynamic";
export const GET = route(async () => {
  const h = await getHealth();
  return { ok: true, db: h.db, migrations: h.migrations };
});
