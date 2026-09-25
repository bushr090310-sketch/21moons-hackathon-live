import type { Metadata } from "next";
import { TeamApp } from "./team-app";

export const metadata: Metadata = { title: "Team" };

export default function Page() {
  return <TeamApp />;
}
