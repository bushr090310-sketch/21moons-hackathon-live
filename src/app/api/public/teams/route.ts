import { route } from "@/lib/server/http";
import { db } from "@/lib/server/db";
import { listLoginTeams } from "@/lib/server/teams";

export const dynamic = "force-dynamic";
export const GET = route(async () => {
  const [s] = await db()`select team_registration_open from event_settings where id = 1`;
  return { teams: await listLoginTeams(), registrationOpen: s?.team_registration_open !== false };
});
