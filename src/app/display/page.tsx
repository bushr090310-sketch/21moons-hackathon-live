import type { Metadata } from "next";
import { DisplayBoard } from "./display-board";
import { initialPublicState } from "@/lib/server/initial";

export const metadata: Metadata = { title: "Projector" };

export default async function Page() {
  return <DisplayBoard initial={await initialPublicState()} />;
}
