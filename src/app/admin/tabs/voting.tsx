"use client";

import { Trophy, Vote } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Empty } from "@/components/ui";
import type { AdminCtx } from "../admin-app";
import { SectionTitle, Stat, Toggle } from "./shared";

export function VotingTab({ s, act, confirm }: AdminCtx) {
  const [tie, setTie] = useState<{ teamId: string; name: string; votes: number }[] | null>(null);
  const vc = s.challenges.find((c) => c.type === "VOTE" && c.state !== "archived");
  const state = s.settings.votingState;
  const max = Math.max(1, ...s.voting.counts.map((c) => c.votes));

  const setState = async (next: "not_open" | "open" | "closed") => {
    const r = await confirm({
      title: next === "open" ? "Open voting?" : next === "closed" ? "Close voting?" : "Reset to not open?",
      body: next === "open" ? "Participants can vote at /vote with their personal codes." : next === "closed" ? "No more votes will be accepted." : "Voting will show as not open. Existing votes are kept.",
      confirmLabel: "Confirm", danger: next === "closed",
    });
    if (r.ok) await act({ action: "voting.set", state: next }, "Voting state updated");
  };

  const finalize = async (mode: "auto" | "co_winners" | "runoff_winner", winnerTeamIds?: string[]) => {
    const r = await confirm({
      title: mode === "co_winners" ? "Declare co-winners?" : mode === "runoff_winner" ? "Confirm run-off winner?" : "Finalize People's Choice?",
      body: mode === "co_winners" ? `Every tied team receives ${vc?.points ?? 25} points.` : `Awards ${vc?.points ?? 25} points to the winner. Ties are shown to you — nothing is awarded automatically on a tie.`,
      confirmLabel: "Finalize",
    });
    if (!r.ok) return;
    const res = await act({ action: "voting.finalize", challengeId: vc?.id, mode, winnerTeamIds }, (x) => {
      const out = x as { tie: boolean; awarded?: { team: string }[] };
      return out.tie ? null : `People's Choice: ${out.awarded?.map((a) => a.team).join(", ")}`;
    });
    if (res.ok) {
      const out = res.result as { tie: boolean; leaders?: { teamId: string; name: string; votes: number }[] };
      setTie(out.tie ? out.leaders ?? [] : null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Voting" value={state === "open" ? "OPEN" : state === "closed" ? "CLOSED" : "NOT OPEN"} tone={state === "open" ? "ok" : undefined} />
        <Stat label="Votes cast" value={`${s.voting.voted}/${s.voting.voters}`} sub={s.voting.voters ? `${Math.round((s.voting.voted / s.voting.voters) * 100)}% turnout` : undefined} />
        <Stat label="Award" value={vc ? `+${vc.points}` : "—"} sub={vc?.title ?? "No VOTE challenge"} tone="cyan" />
        <Stat label="Finalized" value={vc?.finalizedAt ? "YES" : "NO"} sub={vc?.winnersAll.length ? vc.winnersAll.join(", ") : undefined} tone={vc?.finalizedAt ? "violet" : undefined} />
      </section>

      <section className="flex flex-wrap gap-2">
        {state !== "open" && <Button variant="primary" onClick={() => setState("open")}><Vote className="size-4" /> Open voting</Button>}
        {state === "open" && <Button variant="danger" onClick={() => setState("closed")}>Close voting</Button>}
        {state === "closed" && <Button variant="ghost" onClick={() => setState("not_open")}>Reset to not open</Button>}
        {state === "closed" && !vc?.finalizedAt && <Button variant="primary" onClick={() => finalize("auto")}><Trophy className="size-4" /> Finalize People&apos;s Choice</Button>}
      </section>

      {tie && (
        <section className="panel border-warn/40 p-4">
          <p className="font-semibold text-warn">Tie at the top — nothing has been awarded.</p>
          <p className="mt-1 text-sm text-mist">Tied: {tie.map((t) => `${t.name} (${t.votes})`).join(", ")}. Run a quick run-off in the room and pick the winner, or declare co-winners.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {tie.map((t) => <Button key={t.teamId} onClick={() => finalize("runoff_winner", [t.teamId])}>Run-off winner: {t.name}</Button>)}
            <Button variant="primary" onClick={() => finalize("co_winners")}>Declare co-winners</Button>
          </div>
        </section>
      )}

      <section>
        <SectionTitle right={<Badge tone="warn">Organizers only</Badge>}>Live counts</SectionTitle>
        {s.voting.counts.length === 0 ? <Empty title="No teams" /> : (
          <ul className="panel flex flex-col gap-2 p-4">
            {s.voting.counts.map((c) => (
              <li key={c.teamId} className="flex items-center gap-3 text-sm">
                <span className="w-40 truncate">{c.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full bg-gradient-to-r from-violet to-cyan" style={{ width: `${(c.votes / max) * 100}%` }} /></span>
                <span className="w-8 text-right font-semibold tabular">{c.votes}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel p-4">
        <Toggle label="Show vote counts publicly after voting closes" hint="Off by default. Counts are never public while voting is open." checked={s.settings.votingResultsPublic} onChange={(v) => void act({ action: "settings.update", votingResultsPublic: v }, "Saved")} />
      </section>
    </div>
  );
}
