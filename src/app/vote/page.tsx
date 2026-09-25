import type { Metadata } from "next";
import { VoteApp } from "./vote-app";

export const metadata: Metadata = { title: "People's Choice" };

export default function Page() {
  return <VoteApp />;
}
