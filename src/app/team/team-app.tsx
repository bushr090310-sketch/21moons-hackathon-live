"use client";

import { CheckCircle2, Clock, KeyRound, LogOut, Users, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TeamState } from "@/lib/server/state";
import { fmtTime } from "@/lib/shared/time";
import { SiteHeader, LivePill, SponsorStrip } from "@/components/brand";
import { DropOverlay, FrozenBanner, NextDrop, ScoreNumber, useDropQueue } from "@/components/board";
import { ChallengeCard } from "@/components/challenge-card";
import { useLiveData, useNow } from "@/components/live";
import { useToast } from "@/components/toast";
import { Badge, Button, Empty, Input, Label, Select, Spinner, api, cx } from "@/components/ui";
import { ApplyModal } from "./apply-modal";

type Challenge = TeamState["challenges"][number];

export function TeamApp() {
  const live = useLiveData<TeamState>("/api/team/me", { channel: "public", interval: 8000 });
  if (!live.data && live.status === null) return (<><SiteHeader /><Spinner /></>);
  if (!live.data && live.status === 401) return <TeamLogin onLoggedIn={live.refresh} />;
  if (!live.data) return (<><SiteHeader /><div className="mx-auto max-w-lg p-6"><Empty title="Couldn't load your dashboard">{live.error}</Empty></div></>);
  return <Dashboard state={live.data} conn={live.conn} offset={live.serverOffset} refresh={live.refresh} />;
}

function TeamLogin({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [teams, setTeams] = useState<{ id: string; name: string }[] | null>(null);
  const [teamId, setTeamId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ teams: { id: string; name: string }[] }>("/api/public/teams", undefined, "GET").then((r) => setTeams(r.teams)).catch((e) => setErr(e.message));
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/team/login", { teamId, code });
      setCode("");
      await onLoggedIn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-md flex-col px-4 pt-10 sm:pt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-violet">Team access</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gradient">Sign in to your team</h1>
        <p className="mt-2 text-sm text-mist">Use the team code from your organizer card. Everyone on the team shares the same code.</p>
        <form onSubmit={submit} className="panel mt-6 flex flex-col gap-4 p-5">
          <label>
            <Label>Your team</Label>
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
              <option value="">{teams === null ? "Loading teams…" : teams.length ? "Choose your team" : "No teams yet — ask an organizer"}</option>
              {teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </label>
          <label>
            <Label>Team code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false} className="font-mono tracking-widest" required />
          </label>
          {err && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!teamId || code.length < 4}>
            <KeyRound className="size-4" /> Enter
          </Button>
        </form>
      </main>
    </>
  );
}

function Dashboard({ state: s, conn, offset, refresh }: { state: TeamState; conn: "live" | "polling" | "offline"; offset: number; refresh: () => Promise<void> }) {
  const now = useNow(offset);
  const toast = useToast();
  const [applyTo, setApplyTo] = useState<Challenge | null>(null);
  const [tab, setTab] = useState<"available" | "done" | "all">("available");
  const drops = useDropQueue(s.challenges);
  useReviewNotifications(s, toast);

  const groups = useMemo(() => {
    const available = s.challenges.filter((c) => c.my.canApply || c.my.pending);
    const done = s.challenges.filter((c) => c.my.approvedCount > 0);
    return { available, done, all: s.challenges };
  }, [s.challenges]);
  const pending = s.submissions.filter((x) => x.status === "pending");
  const rejected = s.submissions.filter((x) => x.status === "rejected").slice(0, 5);

  const logout = async () => {
    await api("/api/team/logout", {});
    location.reload();
  };

  return (
    <>
      <SiteHeader right={<LivePill conn={conn} frozen={s.event.frozen} />} />
      <main className="mx-auto max-w-6xl px-4 pb-12 pt-6">
        <section className="panel relative overflow-hidden p-5 sm:p-6">
          <div className="absolute -right-24 -top-24 size-72 rounded-full bg-violet/10 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-violet">Team</p>
              <h1 className="mt-1 truncate text-3xl font-semibold tracking-tight text-gradient sm:text-4xl">{s.team.name}</h1>
              <p className="mt-2 flex items-center gap-2 text-sm text-mist"><Users className="size-4" /> {s.members.join(" · ") || "No members listed"}</p>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-[0.25em] text-dim">Score</p>
                <ScoreNumber value={s.score} className="text-4xl font-semibold tabular text-silver" />
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-[0.25em] text-dim">Rank</p>
                <p className="text-4xl font-semibold tabular text-silver">{s.rank ?? "—"}<span className="text-lg text-dim">/{s.teamsCount}</span></p>
              </div>
            </div>
          </div>
          <div className="relative mt-4 flex justify-end">
            <Button variant="ghost" size="sm" onClick={logout}><LogOut className="size-4" /> Sign out</Button>
          </div>
        </section>

        {s.event.frozen && <div className="mt-4"><FrozenBanner frozenAt={s.event.frozenAt} /></div>}
        {!s.event.submissionsOpen && <p className="mt-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">Submissions are paused by the organizers right now.</p>}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section>
            <div className="mb-4 flex items-center gap-1 rounded-lg border border-line bg-white/[0.02] p-1 text-sm">
              {(["available", "done", "all"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cx("flex-1 rounded-md px-3 py-1.5 transition", tab === t ? "bg-white/[0.08] text-silver" : "text-mist")}>
                  {t === "available" ? `Available (${groups.available.length})` : t === "done" ? `Completed (${groups.done.length})` : "All"}
                </button>
              ))}
            </div>
            {groups[tab].length === 0 ? (
              <Empty title={tab === "done" ? "Nothing completed yet — go ship!" : "No challenges here right now"}>New challenges drop during the day.</Empty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {groups[tab].map((c) => (
                  <ChallengeCard key={c.id} c={c} now={now} compact>
                    <ChallengeAction c={c} onApply={() => setApplyTo(c)} />
                  </ChallengeCard>
                ))}
              </div>
            )}
          </section>

          <aside className="flex flex-col gap-4">
            <NextDrop at={s.nextDropAt} now={now} />
            <div className="panel p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-mist">Your applications</h2>
              {s.submissions.length === 0 ? <p className="text-sm text-dim">No applications yet.</p> : (
                <ul className="flex flex-col gap-3">
                  {[...pending, ...s.submissions.filter((x) => x.status !== "pending")].slice(0, 12).map((x) => (
                    <li key={x.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span>{x.emoji}</span>
                        <span className="min-w-0 flex-1 truncate text-silver">{x.challenge}</span>
                        <StatusBadge status={x.status} />
                      </div>
                      <p className="mt-0.5 pl-6 text-xs text-dim">Sent {fmtTime(x.submittedAt)}{x.reviewedAt ? ` · reviewed ${fmtTime(x.reviewedAt)}` : ""}</p>
                      {x.status === "rejected" && x.reviewNote && <p className="mt-1 ml-6 rounded-md bg-bad/10 px-2 py-1 text-xs text-bad">{x.reviewNote}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {rejected.length > 0 && <p className="mt-3 text-xs text-dim">Rejected? Read the reason and apply again if it can be fixed.</p>}
            </div>
            <div className="panel p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-mist">Score history</h2>
              {s.history.length === 0 ? <p className="text-sm text-dim">No points yet.</p> : (
                <ul className="flex flex-col gap-2 text-sm">
                  {s.history.map((h) => (
                    <li key={h.id} className="flex items-center gap-3">
                      <span className={cx("w-[3.5ch] text-right font-semibold tabular", h.delta > 0 ? "text-cyan" : "text-bad")}>{h.delta > 0 ? "+" : ""}{h.delta}</span>
                      <span className="min-w-0 flex-1 truncate text-mist">{h.label}</span>
                      <span className="text-xs tabular text-dim">{fmtTime(h.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {s.event.frozen && <p className="mt-3 text-xs text-cyan/80">Points awarded after the freeze are revealed at the ceremony.</p>}
            </div>
          </aside>
        </div>
      </main>
      <SponsorStrip sponsors={s.event.sponsors} />
      <ApplyModal challenge={applyTo} onClose={() => setApplyTo(null)} onDone={() => void refresh()} />
      <DropOverlay challenge={drops.current} onDone={drops.dismiss} />
    </>
  );
}

function ChallengeAction({ c, onApply }: { c: Challenge; onApply: () => void }) {
  if (c.my.pending) return <div className="flex items-center gap-2 text-sm text-warn"><Clock className="size-4" /> Awaiting organizer review</div>;
  return (
    <div className="flex flex-col gap-2">
      {c.my.approvedCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-ok">
          <CheckCircle2 className="size-4" />
          {c.type === "COMPETITIVE" ? "Entry verified — winner picked at the end" : c.type === "REPEATABLE" ? `Awarded ${c.my.units}/${c.maxCompletions}` : "Completed"}
        </div>
      )}
      {c.my.rejectedNote && (
        <p className="flex gap-2 rounded-md bg-bad/10 px-2.5 py-1.5 text-xs text-bad"><XCircle className="mt-px size-3.5 shrink-0" /> Rejected: {c.my.rejectedNote}</p>
      )}
      {c.my.canApply ? (
        <Button variant="primary" onClick={onApply} className="w-full">
          {c.my.rejectedNote ? "Apply again" : c.type === "COMPETITIVE" && c.my.approvedCount > 0 ? "Submit updated entry" : "Apply / submit"}
        </Button>
      ) : (
        c.my.blockReason && c.my.approvedCount === 0 && <p className="text-xs uppercase tracking-wider text-dim">{c.my.blockReason}</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge tone="ok">Approved</Badge>;
  if (status === "rejected") return <Badge tone="bad">Rejected</Badge>;
  return <Badge tone="warn">Pending</Badge>;
}

/** Toast when an application gets reviewed. */
function useReviewNotifications(s: TeamState, toast: ReturnType<typeof useToast>) {
  const prev = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const cur = new Map(s.submissions.map((x) => [x.id, x.status]));
    const p = prev.current;
    prev.current = cur;
    if (!p) return;
    for (const x of s.submissions) {
      if (p.get(x.id) === "pending" && x.status === "approved") toast.success(`${x.emoji} ${x.challenge} approved!`, "Nice work.");
      if (p.get(x.id) === "pending" && x.status === "rejected") toast.error(`${x.challenge} rejected`, x.reviewNote ?? undefined);
    }
  }, [s.submissions, toast]);
}

