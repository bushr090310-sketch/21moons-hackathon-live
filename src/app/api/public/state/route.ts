import { route } from "@/lib/server/http";
import { getPublicState } from "@/lib/server/state";

export const dynamic = "force-dynamic";
export const GET = route(async () => getPublicState());
