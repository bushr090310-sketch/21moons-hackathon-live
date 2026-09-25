import type { PublicState } from "@/lib/shared/types";
import { getPublicState } from "./state";

/** Server-side initial render data. Never throws — the client will poll anyway. */
export async function initialPublicState(): Promise<PublicState | null> {
  try {
    return await getPublicState();
  } catch (e) {
    console.error("[initial state]", (e as Error).message);
    return null;
  }
}
