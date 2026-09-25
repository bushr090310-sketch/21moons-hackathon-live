"use client";

import { Check, ExternalLink, FileText, Inbox as InboxIcon, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtTimeSec } from "@/lib/shared/time";
import { TYPE_LABEL } from "@/lib/shared/types";
import { Badge, Button, Empty, Input, Label, Modal, Select, Textarea, cx } from "@/components/ui";
import type { AdminCtx } from "../admin-app";
import type { AdminSubmission } from "./shared";

const QUICK_REASONS = [
  "Evidence is unclear — please add a screenshot or link that shows it.",
  "Doesn't meet the challenge criteria yet.",
  "Link doesn't work or isn't public.",
  "Customer/user must be outside the team and genuine.",
  "Happened before the challenge was revealed.",
];

function ago(iso: string, now: number) {
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

export function InboxTab({ s, now, act, confirm }: AdminCtx) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [team, setTeam] = useState("");
  const [challenge, setChallenge] = useState("");
  const [rejecting, setRejecting] = useState<AdminSubmission | null>(null);

  const list = useMemo(() => {
    const l = s.submissions.filter((x) => (status === "all" || x.status === status) && (!team || x.teamId === team) && (!challenge || x.challengeId === challenge));
    if (status === "pending") l.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime() || a.seq - b.seq);
    return l;
  }, [s.submissions, status, team, challenge]);

  // FIRST_GLOBAL queue positions among pending applications.
  const queue = useMemo(() => {
    const m = new Map<string, { pos: number; ahead: string | null }>();
    const byChallenge = new Map<string, AdminSubmission[]>();
    for (const x of s.submissions) {
      if (x.status !== "pending" || x.challengeType !== "FIRST_GLOBAL") continue;
      const arr = byChallenge.get(x.challengeId) ?? [];
      arr.push(x);
      byChallenge.set(x.challengeId, arr);
    }
    for (const arr of byChallenge.values()) {
      arr.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime() || a.seq - b.seq);
      arr.forEach((x, i) => m.set(x.id, { pos: i + 1, ahead: i > 0 ? arr[0].teamName : null }));
    }
    return m;
  }, [s.submissions]);

  const counts = {
    pending: s.submissions.filter((x) => x.status === "pending").length,
    approved: s.submissions.filter((x) => x.status === "approved").length,
    rejected: s.submissions.filter((x) => x.status === "rejected").length,
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex rounded-lg border border-line bg-white/[0.02] p-1 text-sm">
          {(["pending", "approved", "rejected", "all"] as const).map((k) => (
            <button key={k} onClick={() => setStatus(k)} className={cx("flex-1 rounded-md px-3 py-1.5 capitalize transition", status === k ? "bg-white/[0.08] text-silver" : "text-mist")}>
              {k}{k !== "all" ? ` (${counts[k]})` : ""}
            </button>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-md sm:ml-auto">
          <Select value={team} onChange={(e) => setTeam(e.target.value)} className="!h-9 text-sm">
            <option value="">All teams</option>
            {s.teams.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select value={challenge} onChange={(e) => setChallenge(e.target.value)} className="!h-9 text-sm">
            <option value="">All challenges</option>
            {s.challenges.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.title}</option>)}
          </Select>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty icon={<InboxIcon className="size-6" />} title={status === "pending" ? "Inbox zero — no applications waiting" : "Nothing here"}>New applications appear here automatically.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((x) => (
            <SubmissionCard key={x.id} x={x} now={now} queue={queue.get(x.id)} act={act} confirm={confirm} onReject={() => setRejecting(x)} />
          ))}
        </div>
      )}
      <RejectModal x={rejecting} onClose={() => setRejecting(null)} act={act} />
    </div>
  );
}

function SubmissionCard({ x, now, queue, act, confirm, onReject }: { x: AdminSubmission; now: number; queue?: { pos: number; ahead: string | null }; act: AdminCtx["act"]; confirm: AdminCtx["confirm"]; onReject: () => void }) {
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState(1);
  const [verified, setVerified] = useState(x.verifiedValue?.toString() ?? x.numericValue?.toString() ?? "");
  const eligibilityOnly = x.challengeType === "COMPETITIVE" || x.challengeType === "JUDGED" || x.challengeType === "VOTE";
  const fresh = x.status === "pending" && now - new Date(x.submittedAt).getTime() < 5 * 60_000;
  const blocked = queue && queue.pos > 1;

  const approve = async () => {
    setBusy(true);
    const payload: Record<string, unknown> = { action: "submission.approve", id: x.id };
    if (x.challengeType === "REPEATABLE") payload.units = units;
    if (eligibilityOnly && verified.trim() !== "") payload.verifiedValue = Number(verified.replace(",", "."));
    await act(payload, (r) => {
      const res = r as { awarded: number; eligibleOnly: boolean };
      return res.eligibleOnly ? `${x.teamName}: entry verified (no points yet)` : `+${res.awarded} → ${x.teamName} · ${x.challengeTitle}`;
    });
    setBusy(false);
  };

  const revoke = async () => {
    const r = await confirm({
      title: "Revoke this approval?",
      body: "A compensating ledger entry removes the points; history is kept. For FIRST challenges this reopens the claim.",
      input: { label: "Reason (visible to the team)", required: true },
      confirmLabel: "Revoke",
      danger: true,
    });
    if (r.ok) await act({ action: "submission.revoke", id: x.id, note: r.value }, "Approval revoked");
  };

  return (
    <article className={cx("panel flex flex-col gap-3 p-4", x.status === "pending" ? "border-warn/25" : x.status === "approved" ? "border-ok/20" : "border-bad/20")}>
      <header className="flex items-start gap-3">
        <span className="text-2xl">{x.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {fresh && <Badge tone="warn">New application</Badge>}
            {x.status === "pending" ? <Badge tone="warn">Pending</Badge> : x.status === "approved" ? <Badge tone="ok">Approved</Badge> : <Badge tone="bad">Rejected</Badge>}
            <Badge>{TYPE_LABEL[x.challengeType]}</Badge>
          </div>
          <p className="mt-1.5 text-lg font-semibold leading-tight text-silver">{x.teamName}</p>
          <p className="text-sm text-mist">{x.challengeTitle}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular text-cyan">
            {eligibilityOnly ? "—" : `+${x.points}`}{x.challengeType === "REPEATABLE" ? <span className="text-xs text-dim"> ×{x.maxCompletions} max</span> : null}
          </p>
          <p className="text-xs tabular text-dim">{fmtTimeSec(x.submittedAt)}</p>
          <p className="text-[11px] text-dim">{ago(x.submittedAt, now)}</p>
        </div>
      </header>

      {queue && x.status === "pending" && (
        <p className={cx("rounded-md px-2.5 py-1.5 text-xs", blocked ? "bg-warn/10 text-warn" : "bg-ok/10 text-ok")}>
          {blocked ? `#${queue.pos} in line — resolve ${queue.ahead}'s earlier application first.` : "First in line for this FIRST challenge."}
        </p>
      )}

      <p className="whitespace-pre-wrap break-words text-sm text-silver/90">{x.description}</p>
      {(x.evidenceUrl || x.numericValue != null) && (
        <div className="flex flex-wrap gap-2 text-sm">
          {x.evidenceUrl && (
            <a href={x.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-line bg-white/[0.03] px-2.5 py-1 text-violet hover:underline">
              <ExternalLink className="size-3.5 shrink-0" /> <span className="truncate">{x.evidenceUrl.replace(/^https?:\/\//, "")}</span>
            </a>
          )}
          {x.numericValue != null && <span className="rounded-md border border-line bg-white/[0.03] px-2.5 py-1">Value: <b className="tabular">{x.numericValue}</b>{x.verifiedValue != null && x.verifiedValue !== x.numericValue ? <> · verified <b className="tabular text-ok">{x.verifiedValue}</b></> : null}</span>}
        </div>
      )}
      {x.files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {x.files.map((f) => (
            <a key={f.id} href={`/api/admin/evidence/${f.id}`} target="_blank" rel="noopener noreferrer" className="group relative block overflow-hidden rounded-lg border border-line bg-black/40" title={f.name ?? "evidence"}>
              {f.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/admin/evidence/${f.id}`} alt={f.name ?? "evidence"} className="h-24 w-24 object-cover transition group-hover:opacity-80" loading="lazy" />
              ) : (
                <span className="flex h-24 w-24 flex-col items-center justify-center gap-1 text-xs text-mist"><FileText className="size-6" /> PDF</span>
              )}
            </a>
          ))}
        </div>
      )}
      {x.reviewNote && <p className={cx("rounded-md px-2.5 py-1.5 text-xs", x.status === "rejected" ? "bg-bad/10 text-bad" : "bg-white/5 text-mist")}>Note: {x.reviewNote}</p>}

      {x.status === "pending" && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {x.challengeType === "REPEATABLE" && x.maxCompletions > 1 && (
            <label className="flex items-center gap-2 text-sm text-mist">
              Awards:
              <Select value={units} onChange={(e) => setUnits(Number(e.target.value))} className="!h-9 !w-20">
                {Array.from({ length: x.maxCompletions }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
              <span className="text-xs">× {x.points} pts (cap enforced)</span>
            </label>
          )}
          {eligibilityOnly && (
            <label className="block">
              <Label hint="used for ranking at finalization">Verified value</Label>
              <Input inputMode="decimal" value={verified} onChange={(e) => setVerified(e.target.value)} className="!h-9" />
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="danger" size="lg" onClick={onReject}><X className="size-4" /> Reject</Button>
            <Button variant="success" size="lg" onClick={approve} loading={busy} disabled={!!blocked}>
              <Check className="size-4" /> {eligibilityOnly ? "Verify entry" : "Approve"}
            </Button>
          </div>
          {eligibilityOnly && <p className="text-xs text-dim">Verifying makes the entry eligible. Winner points are awarded at finalization.</p>}
        </div>
      )}
      {x.status === "approved" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {eligibilityOnly && (
            <>
              <Input inputMode="decimal" value={verified} onChange={(e) => setVerified(e.target.value)} className="!h-8 !w-32 text-sm" aria-label="Verified value" />
              <Button size="sm" onClick={() => act({ action: "submission.verify_value", id: x.id, value: verified.trim() === "" ? null : Number(verified.replace(",", ".")) }, "Verified value saved")}>Save value</Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={revoke}><Undo2 className="size-4" /> Revoke</Button>
        </div>
      )}
    </article>
  );
}

function RejectModal({ x, onClose, act }: { x: AdminSubmission | null; onClose: () => void; act: AdminCtx["act"] }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!x) return;
    setBusy(true);
    const r = await act({ action: "submission.reject", id: x.id, note }, `Rejected ${x.teamName} · ${x.challengeTitle}`);
    setBusy(false);
    if (r.ok) { setNote(""); onClose(); }
  };
  return (
    <Modal open={!!x} onClose={onClose} title={x ? `Reject ${x.teamName} — ${x.challengeTitle}` : ""}>
      <p className="mb-3 text-sm text-mist">The team sees this reason and can apply again.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {QUICK_REASONS.map((r) => (
          <button key={r} onClick={() => setNote(r)} className="rounded-full border border-line px-3 py-1 text-left text-xs text-mist hover:border-line-strong hover:text-silver">{r}</button>
        ))}
      </div>
      <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the team" autoFocus />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={submit} loading={busy} disabled={note.trim().length < 3}>Reject application</Button>
      </div>
    </Modal>
  );
}
