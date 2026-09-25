"use client";

import { Undo2 } from "lucide-react";
import { useState } from "react";
import { fmtTimeSec } from "@/lib/shared/time";
import { Badge, Button, Empty, Input, Label, Select, cx } from "@/components/ui";
import type { AdminCtx } from "../admin-app";
import { MiniBoard } from "./overview";
import { SectionTitle } from "./shared";

const TYPE_TONE: Record<string, "ok" | "violet" | "cyan" | "warn" | "bad" | "neutral"> = {
  challenge_award: "ok", final_award: "violet", vote_award: "violet", manual_adjustment: "warn", reversal: "bad",
};

export function ScoresTab({ s, act, confirm }: AdminCtx) {
  const [teamId, setTeamId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = Number(delta);
    const team = s.teams.find((t) => t.id === teamId);
    const r = await confirm({ title: `${d > 0 ? "+" : ""}${d} points to ${team?.name}?`, body: <>Reason: {reason}<br />Public label: {label || (d > 0 ? "Organizer bonus" : "Organizer correction")}</>, confirmLabel: "Add ledger entry" });
    if (!r.ok) return;
    setBusy(true);
    const res = await act({ action: "score.adjust", teamId, delta: d, reason, publicLabel: label || undefined }, `Adjusted ${team?.name} by ${d > 0 ? "+" : ""}${d}`);
    setBusy(false);
    if (res.ok) { setDelta(""); setReason(""); setLabel(""); }
  };

  const reverse = async (id: number, text: string) => {
    const r = await confirm({ title: "Reverse this entry?", body: <>A compensating entry is added for: <b className="text-silver">{text}</b>. Nothing is deleted.</>, input: { label: "Reason", required: true }, confirmLabel: "Reverse", danger: true });
    if (r.ok) await act({ action: "score.reverse", ledgerId: id, reason: r.value }, "Entry reversed");
  };

  const ledger = s.ledger.filter((l) => !filter || l.teamId === filter);
  const deltaNum = Number(delta);

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-6">
        <section>
          <SectionTitle>Manual score adjustment</SectionTitle>
          <form onSubmit={submit} className="panel flex flex-col gap-3 p-4">
            <label><Label>Team</Label>
              <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
                <option value="">Choose team</option>
                {s.teams.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.score})</option>)}
              </Select>
            </label>
            <label><Label hint="negative to deduct">Points (+/-)</Label><Input inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="-15" required /></label>
            <label><Label>Reason (internal, required)</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Duplicate evidence on First Sale" required /></label>
            <label><Label hint="shown on public feed">Public label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={deltaNum > 0 ? "Organizer bonus" : "Organizer correction"} maxLength={120} /></label>
            <Button type="submit" variant="primary" loading={busy} disabled={!teamId || !Number.isInteger(deltaNum) || deltaNum === 0 || reason.trim().length < 3}>Add ledger entry</Button>
          </form>
        </section>
        <section>
          <SectionTitle>Real leaderboard</SectionTitle>
          <MiniBoard rows={s.leaderboard} />
        </section>
      </div>
      <section>
        <SectionTitle right={
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="!h-8 !w-48 text-sm">
            <option value="">All teams</option>
            {s.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        }>Score ledger (append-only)</SectionTitle>
        {ledger.length === 0 ? <Empty title="No ledger entries yet" /> : (
          <ul className="panel divide-y divide-line overflow-hidden">
            {ledger.map((l) => (
              <li key={l.id} className={cx("flex items-start gap-3 px-4 py-2.5 text-sm", l.reversed && "opacity-50")}>
                <span className={cx("w-12 shrink-0 text-right font-semibold tabular", l.delta > 0 ? "text-cyan" : "text-bad")}>{l.delta > 0 ? "+" : ""}{l.delta}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.teamName}</span>
                    <Badge tone={TYPE_TONE[l.type]}>{l.type.replace("_", " ")}</Badge>
                    {l.reversed && <Badge>reversed</Badge>}
                  </div>
                  <p className="truncate text-xs text-mist">{l.reason} <span className="text-dim">· public: {l.publicLabel}</span></p>
                </div>
                <span className="shrink-0 text-xs tabular text-dim">#{l.id} · {fmtTimeSec(l.at)}</span>
                {!l.reversed && l.type !== "reversal" && (
                  <button onClick={() => reverse(l.id, `${l.delta > 0 ? "+" : ""}${l.delta} ${l.teamName} — ${l.reason}`)} className="shrink-0 rounded p-1 text-dim hover:text-bad" title="Reverse (compensating entry)"><Undo2 className="size-4" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-dim">Showing latest 300 entries. Full history: Settings → Export.</p>
      </section>
    </div>
  );
}
