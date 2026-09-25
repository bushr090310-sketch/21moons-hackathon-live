"use client";

import { motion } from "framer-motion";
import { CheckCircle2, Lock, Trophy } from "lucide-react";
import { useState } from "react";
import { SiteHeader } from "@/components/brand";
import { Button, Input, Label, api, cx, useConfirm } from "@/components/ui";

interface VoterStatus {
  voter: { name: string; team: string };
  votingState: "not_open" | "open" | "closed";
  votedFor: { teamId: string; name: string } | null;
  teams: { id: string; name: string; description: string | null }[];
}

export function VoteApp() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<VoterStatus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { confirm, node } = useConfirm();

  const check = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setStatus(await api<VoterStatus>("/api/vote/check", { code }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cast = async () => {
    if (!selected || !status) return;
    const team = status.teams.find((t) => t.id === selected)!;
    const r = await confirm({ title: `Vote for ${team.name}?`, body: "You have one vote and it can't be changed.", confirmLabel: "Cast my vote" });
    if (!r.ok) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ votedFor: string }>("/api/vote/cast", { code, teamId: selected });
      setDone(res.votedFor);
      setCode("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 pb-16 pt-10">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-violet"><Trophy className="size-4" /> People&apos;s Choice</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gradient">Vote for your favourite team</h1>

        {done ? (
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="panel mt-8 flex flex-col items-center p-8 text-center">
            <CheckCircle2 className="size-12 text-ok" />
            <p className="mt-4 text-xl font-semibold">Vote cast for {done}</p>
            <p className="mt-1 text-sm text-mist">Thanks! Results are announced at the ceremony.</p>
          </motion.div>
        ) : !status ? (
          <form onSubmit={check} className="panel mt-8 flex flex-col gap-4 p-5">
            <p className="text-sm text-mist">Enter your personal voting code from your participant card. One person, one vote — and you can&apos;t vote for your own team.</p>
            <label>
              <Label>Voting code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXX-XXXX" className="font-mono text-lg tracking-[0.3em]" autoCapitalize="characters" spellCheck={false} autoComplete="off" required />
            </label>
            {err && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.replace(/[^A-Z0-9]/gi, "").length < 5}>Continue</Button>
          </form>
        ) : (
          <div className="mt-8">
            <p className="text-sm text-mist">Hi <span className="font-medium text-silver">{status.voter.name}</span> ({status.voter.team})</p>
            {status.votedFor ? (
              <div className="panel mt-4 p-6 text-center">
                <CheckCircle2 className="mx-auto size-10 text-ok" />
                <p className="mt-3 font-semibold">You already voted for {status.votedFor.name}.</p>
              </div>
            ) : status.votingState !== "open" ? (
              <div className="panel mt-4 flex flex-col items-center p-6 text-center">
                <Lock className="size-8 text-mist" />
                <p className="mt-3 font-semibold">{status.votingState === "closed" ? "Voting has closed" : "Voting isn't open yet"}</p>
                <p className="mt-1 text-sm text-mist">{status.votingState === "closed" ? "Thanks for taking part." : "Come back when the organizers open voting."}</p>
                {status.votingState === "not_open" && <Button className="mt-4" onClick={() => check()} loading={busy}>Check again</Button>}
              </div>
            ) : (
              <>
                <ul className="mt-4 flex flex-col gap-2">
                  {status.teams.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelected(t.id)}
                        className={cx("w-full rounded-xl border px-4 py-4 text-left transition", selected === t.id ? "border-violet/60 bg-violet/10 ring-2 ring-violet/30" : "border-line bg-white/[0.03] hover:bg-white/[0.06]")}
                      >
                        <span className="font-semibold text-silver">{t.name}</span>
                        {t.description && <span className="mt-0.5 block text-sm text-mist">{t.description}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                {err && <p className="mt-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
                <Button variant="primary" size="lg" className="mt-5 w-full" disabled={!selected} loading={busy} onClick={cast}>Cast vote</Button>
              </>
            )}
            <button onClick={() => { setStatus(null); setSelected(null); setCode(""); }} className="mt-6 text-sm text-dim hover:text-silver">Use a different code</button>
          </div>
        )}
      </main>
      {node}
    </>
  );
}
