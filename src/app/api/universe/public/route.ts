import { json } from "@/lib/server/http";
import { getUniversePublic } from "@/lib/server/universe/state";

export const dynamic = "force-dynamic";

// Never errors: any failure yields { enabled: false } so screens fall back to the plain leaderboard.
export async function GET() {
  return json(await getUniversePublic());
}
