import type { Metadata } from "next";
import { ChallengesView } from "./challenges-view";
import { initialPublicState } from "@/lib/server/initial";

export const metadata: Metadata = { title: "Challenges" };

export default async function Page() {
  return <ChallengesView initial={await initialPublicState()} />;
}
