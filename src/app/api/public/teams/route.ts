import { route } from "@/lib/server/http";
import { listLoginTeams } from "@/lib/server/teams";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ teams: await listLoginTeams() }));
