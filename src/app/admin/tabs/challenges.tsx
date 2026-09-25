"use client";

import { Archive, Copy, Eye, EyeOff, Lock, Pencil, Plus, RotateCcw, Trophy, Unlock, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { STATE_LABEL } from "@/lib/shared/challenge-state";
import { fmtCountdown, fmtDateTime, fmtTime, isoToStockholmLocal, stockholmLocalToIso } from "@/lib/shared/time";
import { CHALLENGE_TYPES, TYPE_LABEL, type ChallengeType } from "@/lib/shared/types";
import { stateTone } from "@/components/challenge-card";
import { Badge, Button, Empty, Input, Label, Modal, Select, Textarea, cx } from "@/components/ui";
import type { AdminCtx } from "../admin-app";
import { SectionTitle, Toggle, type AdminChallenge, type AdminSubmission } from "./shared";

type Filter = "all" | "active" | "upcoming" | "finals" | "closed";

const TYPE_HELP: Record<ChallengeType, string> = {
  FIRST_GLOBAL: "First team approved wins. Locks after the winning approval. Earlier applications must be resolved first.",
  OPEN_ONCE: "Every team can complete it once. Approval awards the points.",
  REPEATABLE: "Teams can earn it several times, up to the cap.",
  COMPETITIVE: "Teams submit entries; approval = verified. Admin picks the winner at the end.",
  JUDGED: "Jury decides. Admin awards the winner at finalization.",
  VOTE: "Winner comes from People's Choice voting.",
};

export function ChallengesTab(ctx: AdminCtx) {
  const { s, now, act, confirm, go, focus } = ctx;
  const [filter, setFilter] = useState<Filter>(focus === "finals" ? "finals" : "all");
  const [editing, setEditing] = useState<AdminChallenge | "new" | null>(focus === "new" ? "new" : null);
  const [finalizing, setFinalizing] = useState<AdminChallenge | null>(null);

  const list = useMemo(() => s.challenges.filter((c) => {
    switch (filter) {
      case "active": return c.state === "active";
      case "upcoming": return c.state === "scheduled" || c.state === "draft";
      case "finals": return ["COMPETITIVE", "JUDGED", "VOTE"].includes(c.type) && c.state !== "archived";
      case "closed": return ["claimed", "finalized", "locked", "expired", "archived"].includes(c.state);
      default: return c.state !== "archived";
    }
  }), [s.challenges, filter]);

  const command = async (c: AdminChallenge, command: string, label: string, danger = false, body?: string) => {
    const r = await confirm({ title: `${label}: ${c.title}?`, body, confirmLabel: label, danger });
    if (r.ok) await act({ action: "challenge.command", id: c.id, command }, `${c.title}: ${label.toLowerCase()} done`);
  };

  return (
    <div>
      <SectionTitle right={<Button variant="primary" size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> New challenge</Button>}>
        Challenge control
      </SectionTitle>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-line bg-white/[0.02] p-1 text-sm">
        {(["all", "active", "upcoming", "finals", "closed"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx("whitespace-nowrap rounded-md px-3 py-1.5 capitalize transition", filter === f ? "bg-white/[0.08] text-silver" : "text-mist")}>
            {f === "upcoming" ? "Scheduled / draft" : f === "finals" ? "Final awards" : f}
          </button>
        ))}
      </div>

      {list.length === 0 ? <Empty title="No challenges in this view" /> : (
        <div className="flex flex-col gap-2">
          {list.map((c) => {
            const isFinal = c.type === "COMPETITIVE" || c.type === "JUDGED" || c.type === "VOTE";
            const revealMs = c.revealAt ? new Date(c.revealAt).getTime() - now : null;
            return (
              <div key={c.id} className="panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="text-2xl">{c.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-silver">{c.title}</span>
                      <span className="text-sm font-semibold tabular text-cyan">{c.points > 0 ? "+" : ""}{c.points}{c.type === "REPEATABLE" ? ` ×${c.maxCompletions}` : ""}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone={stateTone(c.state)}>{STATE_LABEL[c.state]}</Badge>
                      <Badge>{TYPE_LABEL[c.type]}</Badge>
                      {c.isSecret && <Badge tone="violet">Secret</Badge>}
                      {!c.acceptsSubmissions && <Badge>No applications</Badge>}
                      {c.pending > 0 && <Badge tone="warn">{c.pending} pending</Badge>}
                      {c.approved > 0 && <Badge tone="ok">{c.approved} approved</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-dim">
                      {c.state === "scheduled" && revealMs != null && <>Reveals {fmtDateTime(c.revealAt)} · <span className="text-violet">in {fmtCountdown(revealMs)}</span></>}
                      {c.state !== "scheduled" && c.revealAt && <>Revealed {fmtTime(c.revealAt)}</>}
                      {c.expiresAt && <> · Expires {fmtTime(c.expiresAt)}</>}
                      {c.claimedByAll && <> · <span className="text-violet">Claimed by {c.claimedByAll}</span></>}
                      {c.winnersAll.length > 0 && <> · <span className="text-violet">Winner: {c.winnersAll.join(", ")}</span></>}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  {(c.state === "draft" || c.state === "scheduled") && (
                    <Button size="sm" variant="primary" onClick={() => command(c, "activate", "Activate now", false, "Visible immediately everywhere, with the CHALLENGE DROP animation.")}><Zap className="size-3.5" /> Activate now</Button>
                  )}
                  {isFinal && !c.finalizedAt && c.state !== "draft" && c.state !== "archived" && (
                    <Button size="sm" variant="primary" onClick={() => (c.type === "VOTE" ? go("voting") : setFinalizing(c))}><Trophy className="size-3.5" /> Finalize</Button>
                  )}
                  {c.finalizedAt && <Button size="sm" onClick={() => command(c, "reopen", "Reopen", true, "Existing awards are kept. Reverse them in Scores if needed.")}><RotateCcw className="size-3.5" /> Reopen</Button>}
                  <Button size="sm" onClick={() => setEditing(c)}><Pencil className="size-3.5" /> Edit</Button>
                  {c.state === "active" && <Button size="sm" onClick={() => command(c, "lock", "Lock", false, "Teams can no longer apply. Pending applications can still be reviewed.")}><Lock className="size-3.5" /> Lock</Button>}
                  {(c.state === "locked" || c.state === "expired") && !c.finalizedAt && <Button size="sm" onClick={() => command(c, "unlock", "Unlock")}><Unlock className="size-3.5" /> Unlock</Button>}
                  {c.state !== "draft" && c.state !== "archived" && <Button size="sm" variant="ghost" onClick={() => command(c, "hide", "Hide", true, "Hidden from the public and teams (back to draft).")}><EyeOff className="size-3.5" /> Hide</Button>}
                  <Button size="sm" variant="ghost" onClick={() => command(c, "duplicate", "Duplicate")}><Copy className="size-3.5" /></Button>
                  {c.state !== "archived" ? (
                    <Button size="sm" variant="ghost" onClick={() => command(c, "archive", "Archive", true)} aria-label="Archive"><Archive className="size-3.5" /></Button>
                  ) : (
                    <Button size="sm" onClick={() => command(c, "hide", "Restore as draft")}><Eye className="size-3.5" /> Restore</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ChallengeEditor ctx={ctx} challenge={editing} onClose={() => setEditing(null)} />
      <FinalizeModal ctx={ctx} challenge={finalizing} onClose={() => setFinalizing(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function ChallengeEditor({ ctx, challenge, onClose }: { ctx: AdminCtx; challenge: AdminChallenge | "new" | null; onClose: () => void }) {
  return (
    <Modal open={!!challenge} onClose={onClose} wide title={challenge === "new" ? "New challenge" : challenge ? `Edit — ${challenge.title}` : ""}>
      {challenge && <EditorForm key={challenge === "new" ? "new" : challenge.id} ctx={ctx} c={challenge === "new" ? null : challenge} onClose={onClose} />}
    </Modal>
  );
}

function EditorForm({ ctx, c, onClose }: { ctx: AdminCtx; c: AdminChallenge | null; onClose: () => void }) {
  const [f, setF] = useState({
    title: c?.title ?? "",
    emoji: c?.emoji ?? "✨",
    points: String(c?.points ?? 20),
    type: (c?.type ?? "OPEN_ONCE") as ChallengeType,
    status: c?.status ?? "draft",
    revealAt: isoToStockholmLocal(c?.revealAt),
    expiresAt: isoToStockholmLocal(c?.expiresAt),
    isSecret: c?.isSecret ?? false,
    maxCompletions: String(c?.maxCompletions ?? 1),
    acceptsSubmissions: c?.acceptsSubmissions ?? true,
    sortOrder: String(c?.sortOrder ?? 0),
    shortDescription: c?.shortDescription ?? "",
    fullDescription: c?.fullDescription ?? "",
    requireUrl: !!c?.evidence.requireUrl,
    allowFiles: c?.evidence.allowFiles !== false,
    numericLabel: c?.evidence.numericLabel ?? "",
    numericRequired: !!c?.evidence.numericRequired,
    hint: c?.evidence.hint ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const hasAwards = !!c && (c.approved > 0 || c.winnersAll.length > 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const points = Number(f.points);
    if (!f.title.trim()) return setErr("Title is required");
    if (!Number.isInteger(points)) return setErr("Points must be a whole number");
    const revealAt = f.revealAt ? stockholmLocalToIso(f.revealAt) : null;
    const expiresAt = f.expiresAt ? stockholmLocalToIso(f.expiresAt) : null;
    if (f.status === "scheduled" && !revealAt) return setErr("Scheduled challenges need a reveal time");
    if (c && hasAwards && points !== c.points) {
      const r = await ctx.confirm({ title: "Change points?", body: `Points already awarded stay at ${c.points} (the ledger is history). New awards will use ${points}. Use Scores → adjustment if you want to correct past awards.`, confirmLabel: "Save anyway" });
      if (!r.ok) return;
    }
    const data = {
      title: f.title.trim(), emoji: f.emoji.trim() || "✨", points, type: f.type, status: f.status,
      revealAt, expiresAt, isSecret: f.isSecret, maxCompletions: Math.max(1, Number(f.maxCompletions) || 1),
      acceptsSubmissions: f.acceptsSubmissions, sortOrder: Number(f.sortOrder) || 0,
      shortDescription: f.shortDescription.trim(), fullDescription: f.fullDescription.trim(),
      evidence: { requireUrl: f.requireUrl, allowFiles: f.allowFiles, numericLabel: f.numericLabel.trim() || null, numericRequired: f.numericRequired && !!f.numericLabel.trim(), hint: f.hint.trim() || undefined },
    };
    setBusy(true);
    const r = await ctx.act(c ? { action: "challenge.update", id: c.id, data } : { action: "challenge.create", data }, c ? "Challenge saved" : "Challenge created");
    setBusy(false);
    if (r.ok) onClose();
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid grid-cols-[80px_1fr_110px] gap-3">
        <label><Label>Emoji</Label><Input value={f.emoji} onChange={(e) => set("emoji", e.target.value)} className="text-center text-xl" /></label>
        <label><Label>Title *</Label><Input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={80} required /></label>
        <label><Label>Points *</Label><Input inputMode="numeric" value={f.points} onChange={(e) => set("points", e.target.value)} /></label>
      </div>
      <label>
        <Label>Type</Label>
        <Select value={f.type} onChange={(e) => {
          const t = e.target.value as ChallengeType;
          setF((x) => ({ ...x, type: t, acceptsSubmissions: t === "JUDGED" || t === "VOTE" ? false : x.acceptsSubmissions }));
        }}>
          {CHALLENGE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]} ({t})</option>)}
        </Select>
        <p className="mt-1 text-xs text-dim">{TYPE_HELP[f.type]}</p>
      </label>
      <label><Label>Short description (cards & drop animation)</Label><Input value={f.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} maxLength={400} /></label>
      <label><Label>Full description / rules</Label><Textarea rows={3} value={f.fullDescription} onChange={(e) => set("fullDescription", e.target.value)} maxLength={4000} /></label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label>
          <Label>Visibility</Label>
          <Select value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="draft">Draft (hidden)</option>
            <option value="scheduled">Scheduled (reveal at time)</option>
            <option value="live">Live now</option>
            <option value="locked">Locked (visible, closed)</option>
            <option value="archived">Archived</option>
          </Select>
        </label>
        <label><Label hint="Stockholm time">Reveal at</Label><Input type="datetime-local" value={f.revealAt} onChange={(e) => set("revealAt", e.target.value)} /></label>
        <label><Label hint="Stockholm time">Expires at</Label><Input type="datetime-local" value={f.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} /></label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {f.type === "REPEATABLE" && <label><Label>Max awards per team</Label><Input inputMode="numeric" value={f.maxCompletions} onChange={(e) => set("maxCompletions", e.target.value)} /></label>}
        <label><Label hint="lower = first">Sort order</Label><Input inputMode="numeric" value={f.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} /></label>
      </div>

      <div className="rounded-xl border border-line p-3">
        <Toggle label="Secret challenge" hint="Nothing (not even its reveal time) is shown before it is revealed." checked={f.isSecret} onChange={(v) => set("isSecret", v)} />
        <Toggle label="Teams can apply" hint="Off for jury / vote challenges." checked={f.acceptsSubmissions} onChange={(v) => set("acceptsSubmissions", v)} />
        {f.acceptsSubmissions && (
          <>
            <Toggle label="Link required" checked={f.requireUrl} onChange={(v) => set("requireUrl", v)} />
            <Toggle label="Allow file uploads" hint="JPEG / PNG / WebP / PDF, 8 MB, max 3" checked={f.allowFiles} onChange={(v) => set("allowFiles", v)} />
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <label><Label hint="empty = no number field">Number field label</Label><Input value={f.numericLabel} onChange={(e) => set("numericLabel", e.target.value)} placeholder="e.g. Revenue (SEK)" /></label>
              <div className="flex items-end"><Toggle label="Number required" checked={f.numericRequired} onChange={(v) => set("numericRequired", v)} /></div>
            </div>
            <label className="mt-2 block"><Label>Hint for teams</Label><Input value={f.hint} onChange={(e) => set("hint", e.target.value)} maxLength={300} /></label>
          </>
        )}
      </div>
      {hasAwards && <p className="text-xs text-warn">This challenge already has approvals/awards. Point changes only affect future awards.</p>}
      {err && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>{c ? "Save changes" : "Create challenge"}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
function FinalizeModal({ ctx, challenge, onClose }: { ctx: AdminCtx; challenge: AdminChallenge | null; onClose: () => void }) {
  return (
    <Modal open={!!challenge} onClose={onClose} wide title={challenge ? <span>{challenge.emoji} Finalize — {challenge.title}</span> : ""}>
      {challenge && <FinalizeForm key={challenge.id} ctx={ctx} c={challenge} onClose={onClose} />}
    </Modal>
  );
}

function FinalizeForm({ ctx, c, onClose }: { ctx: AdminCtx; c: AdminChallenge; onClose: () => void }) {
  const submissions = ctx.s.submissions;
  const entries = useMemo(() => {
    if (c.type !== "COMPETITIVE") return [];
    const latest = new Map<string, AdminSubmission>();
    for (const x of submissions) {
      if (x.challengeId !== c.id || x.status !== "approved") continue;
      const prev = latest.get(x.teamId);
      if (!prev || new Date(x.submittedAt) > new Date(prev.submittedAt)) latest.set(x.teamId, x);
    }
    return [...latest.values()]
      .map((x) => ({ teamId: x.teamId, team: x.teamName, value: x.verifiedValue ?? x.numericValue, verified: x.verifiedValue != null, url: x.evidenceUrl }))
      .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  }, [c, submissions]);
  const pendingForChallenge = ctx.s.submissions.filter((x) => x.challengeId === c.id && x.status === "pending").length;
  const candidates = c.type === "COMPETITIVE" ? entries.map((e) => ({ id: e.teamId, name: e.team })) : ctx.s.teams.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }));
  const [selected, setSelected] = useState<string[]>(entries[0] ? [entries[0].teamId] : []);
  const [points, setPoints] = useState(String(c.points));
  const [busy, setBusy] = useState(false);
  const top = entries[0]?.value;
  const tie = entries.length > 1 && entries[1].value === top;

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const submit = async () => {
    const names = candidates.filter((x) => selected.includes(x.id)).map((x) => x.name);
    const r = await ctx.confirm({
      title: `Award ${c.title}?`,
      body: <>Winner{names.length > 1 ? "s" : ""}: <b className="text-silver">{names.join(", ")}</b> — {points} points each. This creates ledger entries and locks the challenge.</>,
      confirmLabel: "Award",
    });
    if (!r.ok) return;
    setBusy(true);
    const res = await ctx.act({ action: "challenge.finalize", id: c.id, winnerTeamIds: selected, points: Number(points) }, `${c.title} awarded to ${names.join(", ")}`);
    setBusy(false);
    if (res.ok) onClose();
  };

  return (
    <div className="flex flex-col gap-4">
      {pendingForChallenge > 0 && <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">{pendingForChallenge} entr{pendingForChallenge === 1 ? "y is" : "ies are"} still pending review in the inbox.</p>}
      {c.type === "COMPETITIVE" && (
        entries.length === 0 ? <Empty title="No verified entries yet">Approve (verify) entries in the inbox first.</Empty> : (
          <>
            <p className="text-sm text-mist">Verified entries, latest per team, ranked by value (verified value if set).{tie && <span className="text-warn"> Tie at the top — pick co-winners or decide.</span>}</p>
            <ul className="flex flex-col gap-2">
              {entries.map((e, i) => (
                <li key={e.teamId}>
                  <button onClick={() => toggle(e.teamId)} className={cx("flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition", selected.includes(e.teamId) ? "border-violet/60 bg-violet/10" : "border-line bg-white/[0.03]")}>
                    <span className="w-5 text-right text-dim">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{e.team}</span>
                    {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-xs text-violet hover:underline">link</a>}
                    <span className="tabular font-semibold">{e.value ?? "—"}</span>
                    {e.verified && <Badge tone="ok">verified</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      )}
      {c.type === "JUDGED" && (
        <>
          <p className="text-sm text-mist">Select the jury&apos;s winner (select several only for an explicit shared award).</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {candidates.map((t) => (
              <button key={t.id} onClick={() => toggle(t.id)} className={cx("rounded-lg border px-3 py-2.5 text-left text-sm transition", selected.includes(t.id) ? "border-violet/60 bg-violet/10" : "border-line bg-white/[0.03]")}>{t.name}</button>
            ))}
          </div>
        </>
      )}
      <label className="max-w-[160px]"><Label>Points each</Label><Input inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!selected.length || !Number.isInteger(Number(points)) || Number(points) === 0}>
          <Trophy className="size-4" /> Award {selected.length > 1 ? `${selected.length} co-winners` : "winner"}
        </Button>
      </div>
    </div>
  );
}
