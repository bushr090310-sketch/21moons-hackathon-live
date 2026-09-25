import { HomeBoard } from "./home-board";
import { initialPublicState } from "@/lib/server/initial";

export default async function Page() {
  return <HomeBoard initial={await initialPublicState()} />;
}
