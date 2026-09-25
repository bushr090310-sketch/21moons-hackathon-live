"use client";

import { Clock, Lock, Trophy, Crown } from "lucide-react";
import { STATE_LABEL } from "@/lib/shared/challenge-state";
import { TYPE_LABEL, type PublicChallenge } from "@/lib/shared/types";
import { fmtCountdown, fmtTime } from "@/lib/shared/time";
import { Badge, cx } from "./ui";

export function stateTone(state: PublicChallenge["state"]) {
  return state === "active" ? "ok" : state === "claimed" || state === "finalized" ? "violet" : state === "expired" || state === "locked" ? "neutral" : "cyan";
}

export function ChallengeCard({ c, now, children, compact }: { c: PublicChallenge; now: number; children?: React.ReactNode; compact?: boolean }) {
  const expMs = c.expiresAt ? new Date(c.expiresAt).getTime() - now : null;
  const endingSoon = c.state === "active" && expMs != null && expMs > 0 && expMs < 60 * 60_000;
  const closed = c.state !== "active";
  return (
    <article className={cx("panel relative flex flex-col overflow-hidden p-4 sm:p-5", closed && "opacity-80")}>
      {endingSoon && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-warn/70 to-transparent" />}
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.04] text-2xl">{c.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight text-silver">{c.title}</h3>
            <span className="shrink-0 rounded-full bg-cyan/10 px-2 py-0.5 text-sm font-semibold tabular text-cyan">
              {c.points > 0 ? "+" : ""}{c.points}{c.type === "REPEATABLE" && c.maxCompletions > 1 ? ` ×${c.maxCompletions}` : ""}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={stateTone(c.state)}>{c.state === "active" ? "Live" : STATE_LABEL[c.state]}</Badge>
            <Badge>{TYPE_LABEL[c.type]}</Badge>
          </div>
        </div>
      </div>
      {!compact && <p className="mt-3 text-sm leading-relaxed text-mist">{c.fullDescription || c.shortDescription}</p>}
      {compact && c.shortDescription && <p className="mt-3 text-sm leading-relaxed text-mist">{c.shortDescription}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mist">
        {c.expiresAt && c.state === "active" && (
          <span className={cx("inline-flex items-center gap-1.5", endingSoon && "font-semibold text-warn")}>
            <Clock className="size-3.5" /> Ends {fmtTime(c.expiresAt)}{expMs != null && expMs > 0 && expMs < 3 * 3600_000 ? ` · ${fmtCountdown(expMs)}` : ""}
          </span>
        )}
        {c.state === "expired" && <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Closed at {fmtTime(c.expiresAt)}</span>}
        {c.state === "claimed" && (
          <span className="inline-flex items-center gap-1.5 font-medium text-violet">
            <Crown className="size-3.5" /> Claimed{c.claimedBy ? ` by ${c.claimedBy}` : ""}
          </span>
        )}
        {c.winners.length > 0 && (
          <span className="inline-flex items-center gap-1.5 font-medium text-violet">
            <Trophy className="size-3.5" /> Winner{c.winners.length > 1 ? "s" : ""}: {c.winners.join(", ")}
          </span>
        )}
        {c.resultsHidden && c.winners.length === 0 && <span className="text-cyan">Result revealed at the final ceremony</span>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </article>
  );
}
