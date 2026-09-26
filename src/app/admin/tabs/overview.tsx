"use client";

import { Download, Eye, Flag, Inbox, Plus, Snowflake, Trophy, UserPlus, Vote, Zap } from "lucide-react";
import { useState } from "react";
import { fmtCountdown, fmtTime } from "@/lib/shared/time";
import type { LeaderboardRow } from "@/lib/shared/types";
import { ActivityFeed } from "@/components/board";
import { Badge, Button, Empty, Modal, cx } from "@/components/ui";
import type { AdminCtx } from "../admin-app";
import { SectionTitle, Stat } from "./shared";

export function Overview({ s, now, act, confirm, go }: AdminCtx) {
  const [dropOpen, setDropOpen] = useState(false);
  const next = s.stats.nextScheduled;
  const frozen = s.settings.frozen;

  const freeze = async () => {
    const r = await confirm({
      title: "Freeze the public leaderboard?",
      body: "Public screens and team dashboards stop showing new points. You keep seeing the real scores and can keep approving. Reveal later with REVEAL FINAL LEADERBOARD.",
      confirmLabel: "Freeze public board",
    });
    if (r.ok) await act({ action: "leaderboard.freeze" }, "Public leaderboard frozen");
  };
  const reveal = async () => {
    const r = await confirm({ title: "Reveal the final leaderboard?", body: "All points awarded during the freeze become visible with the reveal animation on every screen.", confirmLabel: "Reveal now" });
    if (r.ok) await act({ action: "leaderboard.reveal" }, "Final leaderboard revealed");
  };
  const voting = async (state: "open" | "closed") => {
    const r = await confirm({
      title: state === "open" ? "Open People's Choice voting?" : "Close voting?",
      body: state === "open" ? "Participants can vote at /vote with their personal code." : "No more votes will be accepted.",
      confirmLabel: state === "open" ? "Open voting" : "Close voting",
      danger: state === "closed",
    });
    if (r.ok) await act({ action: "voting.set", state }, state === "open" ? "Voting is open" : "Voting closed");
  };

  const registration = async (open: boolean) => {
    const r = await confirm({
      title: open ? "Open team registration?" : "Close team registration?",
      body: open
        ? "Anyone at /team can create a new team (min. 2 participants) and gets their codes immediately."
        : "No new teams can be created at /team. Existing teams can still log in. You can still add teams in the Teams tab.",
      confirmLabel: open ? "Open registration" : "Close registration",
      danger: !open,
    });
    if (r.ok) await act({ action: "settings.update", teamRegistrationOpen: open }, open ? "Team registration is open" : "Team registration closed");
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-9">
        <Stat label="Event time" value={fmtTime(new Date(now))} sub="Europe/Stockholm" />
        <Stat label="Teams" value={s.stats.teams} onClick={() => go("teams")} />
        <Stat label="Pending" value={s.stats.pending} tone={s.stats.pending ? "warn" : undefined} sub={s.stats.pending ? "needs review" : "all clear"} onClick={() => go("inbox")} />
        <Stat label="Active challenges" value={s.stats.activeChallenges} onClick={() => go("challenges")} />
        <Stat
          label="Next drop"
          value={next ? fmtCountdown(new Date(next.revealAt!).getTime() - now) : "—"}
          sub={next ? `${next.emoji} ${next.title} · ${fmtTime(next.revealAt)}` : "nothing scheduled"}
          tone="violet"
          onClick={() => go("challenges")}
        />
        <Stat label="Public board" value={frozen ? "FROZEN" : "LIVE"} tone={frozen ? "cyan" : "ok"} sub={frozen ? `since ${fmtTime(s.settings.frozenAt)}` : "showing real scores"} />
        <Stat label="Voting" value={s.settings.votingState === "open" ? "OPEN" : s.settings.votingState === "closed" ? "CLOSED" : "NOT OPEN"} tone={s.settings.votingState === "open" ? "ok" : undefined} sub={`${s.voting.voted}/${s.voting.voters} voted`} onClick={() => go("voting")} />
        <Stat label="Team registration" value={s.settings.teamRegistrationOpen ? "OPEN" : "CLOSED"} tone={s.settings.teamRegistrationOpen ? "ok" : undefined} sub="self-service at /team" onClick={() => registration(!s.settings.teamRegistrationOpen)} />
        <Stat label="Submissions" value={s.settings.submissionsOpen ? "OPEN" : "PAUSED"} tone={s.settings.submissionsOpen ? "ok" : "warn"} onClick={() => go("settings")} />
      </section>

      <section>
        <SectionTitle>Quick actions</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Button onClick={() => go("teams", { focus: "new" })}><Plus className="size-4" /> Add team</Button>
          {s.settings.teamRegistrationOpen ? (
            <Button variant="danger" onClick={() => registration(false)}><UserPlus className="size-4" /> Close team registration</Button>
          ) : (
            <Button onClick={() => registration(true)}><UserPlus className="size-4" /> Open team registration</Button>
          )}
          <Button onClick={() => go("challenges", { focus: "new" })}><Plus className="size-4" /> New challenge</Button>
          <Button variant={s.stats.pending ? "primary" : "secondary"} onClick={() => go("inbox")}><Inbox className="size-4" /> Review applications{s.stats.pending ? ` (${s.stats.pending})` : ""}</Button>
          <Button onClick={() => setDropOpen(true)}><Zap className="size-4" /> Drop challenge</Button>
          {frozen ? (
            <Button variant="primary" onClick={reveal}><Eye className="size-4" /> Reveal final board</Button>
          ) : (
            <Button onClick={freeze}><Snowflake className="size-4" /> Freeze leaderboard</Button>
          )}
          {s.settings.votingState !== "open" ? (
            <Button onClick={() => voting("open")}><Vote className="size-4" /> Open voting</Button>
          ) : (
            <Button variant="danger" onClick={() => voting("closed")}><Vote className="size-4" /> Close voting</Button>
          )}
          <Button onClick={() => go("challenges", { focus: "finals" })}><Trophy className="size-4" /> Finalize award</Button>
          <a href="/api/admin/export?format=json" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line-strong bg-white/[0.04] px-4 text-sm font-medium text-silver hover:bg-white/[0.08]">
            <Download className="size-4" /> Export event data
          </a>
          <a href="/display" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line-strong bg-white/[0.04] px-4 text-sm font-medium text-silver hover:bg-white/[0.08]">
            Projector screen ↗
          </a>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr_360px]">
        <section>
          <SectionTitle right={<Badge tone="ok">Real / live</Badge>}>Actual leaderboard</SectionTitle>
          <MiniBoard rows={s.leaderboard} />
        </section>
        <section>
          <SectionTitle right={<Badge tone={frozen ? "cyan" : "neutral"}>{frozen ? "Frozen snapshot" : "Same as real"}</Badge>}>Public leaderboard</SectionTitle>
          {frozen && s.publicLeaderboard ? <MiniBoard rows={s.publicLeaderboard} /> : <p className="text-sm text-dim">Not frozen — the public sees the real leaderboard.</p>}
        </section>
        <section>
          <SectionTitle>Latest points (real)</SectionTitle>
          <div className="panel p-4"><ActivityFeed items={s.activity} limit={12} /></div>
        </section>
      </div>

      <Modal open={dropOpen} onClose={() => setDropOpen(false)} title={<span className="flex items-center gap-2"><Zap className="size-5 text-violet" /> Drop a challenge now</span>}>
        <DropList ctx={{ s, now, act, confirm, go } as AdminCtx} onDone={() => setDropOpen(false)} />
      </Modal>
    </div>
  );
}

function DropList({ ctx, onDone }: { ctx: AdminCtx; onDone: () => void }) {
  const candidates = ctx.s.challenges.filter((c) => c.state === "draft" || c.state === "scheduled");
  if (!candidates.length) return <Empty icon={<Flag className="size-6" />} title="No hidden or scheduled challenges">Create one in the Challenges tab.</Empty>;
  return (
    <ul className="flex flex-col gap-2">
      {candidates.map((c) => (
        <li key={c.id} className="flex items-center gap-3 rounded-lg border border-line bg-white/[0.03] p-3">
          <span className="text-xl">{c.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{c.title} {c.isSecret && <Badge tone="violet">Secret</Badge>}</p>
            <p className="text-xs text-dim">{c.state === "scheduled" ? `Scheduled ${fmtTime(c.revealAt)} · in ${fmtCountdown(new Date(c.revealAt!).getTime() - ctx.now)}` : "Draft (hidden)"} · +{c.points}</p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              const r = await ctx.confirm({ title: `Drop "${c.title}" now?`, body: "It becomes visible immediately on every screen with the CHALLENGE DROP animation.", confirmLabel: "Drop it" });
              if (!r.ok) return;
              const res = await ctx.act({ action: "challenge.command", id: c.id, command: "activate" }, `${c.emoji} ${c.title} is live`);
              if (res.ok) onDone();
            }}
          >
            Drop now
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function MiniBoard({ rows }: { rows: LeaderboardRow[] }) {
  if (!rows.length) return <Empty title="No teams yet" />;
  return (
    <ol className="panel divide-y divide-line overflow-hidden">
      {rows.map((r) => (
        <li key={r.teamId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
          <span className={cx("w-6 text-right font-semibold tabular", r.rank <= 3 ? "text-violet" : "text-dim")}>{r.rank}</span>
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
          {r.lastDelta != null && <span className={cx("text-xs tabular", r.lastDelta > 0 ? "text-cyan" : "text-bad")}>{r.lastDelta > 0 ? "+" : ""}{r.lastDelta}</span>}
          <span className="w-12 text-right font-semibold tabular">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}
