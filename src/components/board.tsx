"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ArrowUp, ArrowDown, Snowflake, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActivityItem, LeaderboardRow, PublicChallenge } from "@/lib/shared/types";
import { fmtCountdown, fmtTime } from "@/lib/shared/time";
import { cx } from "./ui";

// ---------------------------------------------------------------------------
// Movement tracking: remembers previous rank/score to show arrows and +N flashes.
// ---------------------------------------------------------------------------
interface Movement { rankDelta: number; scoreDelta: number; at: number }

function useMovement(rows: LeaderboardRow[]) {
  const prev = useRef<Map<string, { rank: number; score: number }> | null>(null);
  const [moves, setMoves] = useState<Record<string, Movement>>({});
  useEffect(() => {
    const p = prev.current;
    const next = new Map(rows.map((r) => [r.teamId, { rank: r.rank, score: r.score }]));
    prev.current = next;
    if (!p) return;
    const now = Date.now();
    const changed: Record<string, Movement> = {};
    for (const r of rows) {
      const old = p.get(r.teamId);
      if (!old) continue;
      if (old.rank !== r.rank || old.score !== r.score) {
        changed[r.teamId] = { rankDelta: old.rank - r.rank, scoreDelta: r.score - old.score, at: now };
      }
    }
    if (Object.keys(changed).length) {
      const t0 = setTimeout(() => setMoves((m) => ({ ...m, ...changed })), 0);
      const t = setTimeout(() => setMoves((m) => {
        const copy = { ...m };
        for (const k of Object.keys(changed)) if (copy[k]?.at === now) delete copy[k];
        return copy;
      }), 9000);
      return () => { clearTimeout(t0); void t; };
    }
  }, [rows]);
  return moves;
}

const RANK_STYLE = [
  "bg-gradient-to-br from-white to-[#c9c3ff] text-[#0b0b14] shadow-[0_0_24px_-4px_rgb(199_190_255/0.8)]",
  "bg-gradient-to-br from-[#d7d9e3] to-[#8e93a6] text-[#0b0b14]",
  "bg-gradient-to-br from-[#9be7f5] to-[#3aa7bd] text-[#06141a]",
];

export function Leaderboard({ rows, now, variant = "page", maxRows }: { rows: LeaderboardRow[]; now: number; variant?: "page" | "display"; maxRows?: number }) {
  const moves = useMovement(rows);
  const list = maxRows ? rows.slice(0, maxRows) : rows;
  const display = variant === "display";
  const n = list.length;
  // Scale rows so a realistic number of teams fits a 16:9 screen without tiny text.
  const dens = display ? (n <= 6 ? "xl" : n <= 9 ? "lg" : n <= 13 ? "md" : "sm") : "page";
  const rowCls = {
    page: "h-16 sm:h-[72px] px-3 sm:px-5 gap-3 sm:gap-4",
    xl: "h-[11vh] px-8 gap-6",
    lg: "h-[8.4vh] px-7 gap-5",
    md: "h-[6.1vh] px-6 gap-4",
    sm: "h-[4.6vh] px-5 gap-4",
  }[dens];
  const nameCls = { page: "text-base sm:text-lg", xl: "text-[3.6vh]", lg: "text-[3vh]", md: "text-[2.4vh]", sm: "text-[2vh]" }[dens];
  const scoreCls = { page: "text-2xl sm:text-3xl", xl: "text-[5.4vh]", lg: "text-[4.4vh]", md: "text-[3.4vh]", sm: "text-[2.6vh]" }[dens];
  const rankCls = { page: "size-9 sm:size-10 text-sm sm:text-base", xl: "size-[7vh] text-[3vh]", lg: "size-[5.6vh] text-[2.5vh]", md: "size-[4.4vh] text-[2vh]", sm: "size-[3.4vh] text-[1.7vh]" }[dens];

  return (
    <LayoutGroup>
      <ol className={cx("flex flex-col", display ? "gap-[0.9vh]" : "gap-2")}>
        <AnimatePresence initial={false}>
          {list.map((r) => {
            const m = moves[r.teamId];
            const recent = r.lastDeltaAt && now - new Date(r.lastDeltaAt).getTime() < 15 * 60_000 && r.lastDelta != null;
            const top = r.rank <= 3 && r.score > 0;
            return (
              <motion.li
                key={r.teamId}
                layout="position"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ layout: { type: "spring", stiffness: 260, damping: 30 }, duration: 0.3 }}
                className={cx(
                  "relative flex items-center overflow-hidden rounded-xl border",
                  rowCls,
                  top && r.rank === 1 ? "border-violet/40 bg-gradient-to-r from-violet/[0.14] via-white/[0.03] to-transparent" : top ? "border-line-strong bg-white/[0.045]" : "border-line bg-white/[0.025]",
                )}
              >
                {m && m.scoreDelta > 0 && (
                  <motion.span
                    className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan/20 via-violet/10 to-transparent"
                    initial={{ opacity: 0.9 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 3.5 }}
                  />
                )}
                <span className={cx("relative grid shrink-0 place-items-center rounded-full font-semibold tabular", rankCls, top ? RANK_STYLE[r.rank - 1] : "border border-line-strong text-mist")}>
                  {r.rank}
                </span>
                <div className="relative min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cx("truncate font-semibold text-silver", nameCls)}>{r.name}</span>
                    {m && m.rankDelta > 0 && (
                      <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center text-ok">
                        <ArrowUp className={display ? "size-[2.4vh]" : "size-4"} />
                        <span className={cx("font-semibold tabular", display ? "text-[1.8vh]" : "text-xs")}>{m.rankDelta}</span>
                      </motion.span>
                    )}
                    {m && m.rankDelta < 0 && (
                      <span className="flex items-center text-bad/80">
                        <ArrowDown className={display ? "size-[2.4vh]" : "size-4"} />
                      </span>
                    )}
                  </div>
                  {(recent || (!display && r.completed > 0)) && (
                    <div className={cx("mt-0.5 flex items-center gap-2 truncate text-mist", display ? "text-[1.6vh]" : "text-xs")}>
                      {recent && (
                        <span className={cx("inline-flex items-center gap-1 font-medium", r.lastDelta! > 0 ? "text-cyan" : "text-bad")}>
                          {r.lastDelta! > 0 ? "+" : ""}{r.lastDelta} <span className="truncate text-mist">{r.lastLabel}</span>
                        </span>
                      )}
                      {!display && r.completed > 0 && !recent && <span>{r.completed} challenge{r.completed === 1 ? "" : "s"} completed</span>}
                    </div>
                  )}
                </div>
                <AnimatePresence>
                  {m && m.scoreDelta !== 0 && (
                    <motion.span
                      key={m.at}
                      initial={{ opacity: 0, y: 10, scale: 0.8 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10 }}
                      className={cx("relative rounded-full px-2 py-0.5 font-semibold tabular", m.scoreDelta > 0 ? "bg-cyan/15 text-cyan" : "bg-bad/15 text-bad", display ? "text-[2.2vh]" : "text-xs")}
                    >
                      {m.scoreDelta > 0 ? "+" : ""}{m.scoreDelta}
                    </motion.span>
                  )}
                </AnimatePresence>
                <ScoreNumber value={r.score} className={cx("relative w-[3.2ch] text-right font-semibold tabular text-silver", scoreCls)} />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </LayoutGroup>
  );
}

/** Counts smoothly to the new value. */
export function ScoreNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{shown}</span>;
}

export function ActivityFeed({ items, variant = "page", limit = 8 }: { items: ActivityItem[]; variant?: "page" | "display"; limit?: number }) {
  const display = variant === "display";
  if (!items.length) {
    return <p className={cx("text-dim", display ? "text-[1.8vh]" : "text-sm")}>No points yet. The first award will appear here.</p>;
  }
  return (
    <ul className={cx("flex flex-col", display ? "gap-[1.1vh]" : "gap-2")}>
      <AnimatePresence initial={false}>
        {items.slice(0, limit).map((a) => (
          <motion.li
            key={a.id}
            layout
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className={cx("flex items-center gap-3", display ? "text-[1.9vh]" : "text-sm")}
          >
            <span className={cx("w-[3.6ch] shrink-0 text-right font-semibold tabular", a.delta > 0 ? "text-cyan" : "text-bad")}>
              {a.delta > 0 ? "+" : ""}{a.delta}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-silver">{a.teamName}</span>
              <span className="text-dim"> — </span>
              <span className="text-mist">{a.emoji ? `${a.emoji} ` : ""}{a.label}</span>
            </span>
            <span className={cx("shrink-0 tabular text-dim", display ? "text-[1.5vh]" : "text-xs")}>{fmtTime(a.at)}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

export function FrozenBanner({ frozenAt, large }: { frozenAt: string | null; large?: boolean }) {
  return (
    <div className={cx("flex items-center gap-3 rounded-xl border border-cyan/30 bg-cyan/[0.07] text-cyan", large ? "px-6 py-3 text-[2vh]" : "px-4 py-3 text-sm")}>
      <Snowflake className={large ? "size-[2.6vh]" : "size-4"} />
      <span>
        <span className="font-semibold">Leaderboard frozen</span>
        <span className="text-cyan/70"> since {fmtTime(frozenAt)} — final scores will be revealed at the ceremony.</span>
      </span>
    </div>
  );
}

export function Countdown({ to, now, className }: { to: string; now: number; className?: string }) {
  const ms = new Date(to).getTime() - now;
  return <span className={cx("tabular", className)}>{fmtCountdown(ms)}</span>;
}

export function NextDrop({ at, now, large }: { at: string | null; now: number; large?: boolean }) {
  if (!at || new Date(at).getTime() <= now) return null;
  return (
    <div className={cx("flex items-center gap-3 rounded-xl border border-violet/25 bg-violet/[0.06]", large ? "px-6 py-4" : "px-4 py-3")}>
      <Zap className={cx("text-violet", large ? "size-[3vh]" : "size-4")} />
      <div className="min-w-0 flex-1">
        <p className={cx("font-semibold uppercase tracking-[0.2em] text-violet", large ? "text-[1.5vh]" : "text-[11px]")}>Next challenge drop</p>
        <p className={cx("text-mist", large ? "text-[1.8vh]" : "text-xs")}>at {fmtTime(at)}</p>
      </div>
      <Countdown to={at} now={now} className={cx("font-semibold text-silver", large ? "text-[4vh]" : "text-xl")} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CHALLENGE DROP overlay: fires when a challenge becomes visible while watching.
// ---------------------------------------------------------------------------
export function useDropQueue(challenges: PublicChallenge[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<PublicChallenge[]>([]);
  useEffect(() => {
    if (!challenges) return;
    if (!seen.current) {
      seen.current = new Set(challenges.map((c) => c.id));
      return;
    }
    const fresh = challenges.filter((c) => !seen.current!.has(c.id));
    fresh.forEach((c) => seen.current!.add(c.id));
    const recent = fresh.filter((c) => !c.revealAt || Date.now() - new Date(c.revealAt).getTime() < 20 * 60_000);
    if (recent.length) {
      const t = setTimeout(() => setQueue((q) => [...q, ...recent]), 0);
      return () => clearTimeout(t);
    }
  }, [challenges]);
  const dismiss = () => setQueue((q) => q.slice(1));
  return { current: queue[0] ?? null, dismiss, remaining: queue.length };
}

export function DropOverlay({ challenge, onDone, large, autoMs = 9000 }: { challenge: PublicChallenge | null; onDone: () => void; large?: boolean; autoMs?: number }) {
  useEffect(() => {
    if (!challenge) return;
    const t = setTimeout(onDone, autoMs);
    return () => clearTimeout(t);
  }, [challenge, onDone, autoMs]);
  return (
    <AnimatePresence>
      {challenge && (
        <motion.div
          key={challenge.id}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDone}
        >
          <motion.div
            className="absolute size-[70vmin] rounded-full border border-violet/30"
            initial={{ scale: 0.2, opacity: 0.8 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 1.8, ease: "easeOut" }}
          />
          <motion.div
            className="absolute size-[50vmin] rounded-full border border-cyan/30"
            initial={{ scale: 0.2, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 2.2, ease: "easeOut", delay: 0.2 }}
          />
          <motion.div
            initial={{ y: 30, scale: 0.92, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 20, stiffness: 180, delay: 0.15 }}
            className={cx("relative w-full max-w-2xl rounded-3xl border border-violet/40 bg-gradient-to-b from-[#16112b] to-[#0a0c13] text-center shadow-[0_0_120px_-20px_rgb(124_58_237/0.7)]", large ? "p-[5vh]" : "p-8")}
          >
            <motion.p
              initial={{ letterSpacing: "0.1em", opacity: 0 }}
              animate={{ letterSpacing: "0.5em", opacity: 1 }}
              transition={{ duration: 1 }}
              className={cx("flex items-center justify-center gap-2 font-semibold uppercase text-violet", large ? "text-[2.2vh]" : "text-xs")}
            >
              <Sparkles className={large ? "size-[2.4vh]" : "size-4"} /> Challenge drop
            </motion.p>
            <div className={cx("mt-5", large ? "text-[12vh] leading-none" : "text-7xl")}>{challenge.emoji}</div>
            <h2 className={cx("mt-4 font-semibold text-gradient", large ? "text-[6vh]" : "text-4xl")}>{challenge.title}</h2>
            <p className={cx("mx-auto mt-3 max-w-xl text-mist", large ? "text-[2.4vh]" : "text-base")}>{challenge.shortDescription}</p>
            <div className={cx("mt-6 flex flex-wrap items-center justify-center gap-3", large ? "text-[2.4vh]" : "text-sm")}>
              <span className="rounded-full border border-cyan/40 bg-cyan/10 px-4 py-1.5 font-semibold text-cyan">
                {challenge.points > 0 ? "+" : ""}{challenge.points} pts{challenge.type === "REPEATABLE" ? ` each (max ${challenge.maxCompletions})` : ""}
              </span>
              {challenge.expiresAt && <span className="rounded-full border border-line-strong px-4 py-1.5 text-mist">Ends {fmtTime(challenge.expiresAt)}</span>}
            </div>
            {!large && <p className="mt-6 text-xs text-dim">Tap anywhere to close</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function RevealOverlay({ revealedAt, now, large }: { revealedAt: string | null; now: number; large?: boolean }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const show = !!revealedAt && dismissed !== revealedAt && now - new Date(revealedAt).getTime() < 12_000 && now - new Date(revealedAt).getTime() > -5000;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 1.2 } }}
          onClick={() => setDismissed(revealedAt)}
        >
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1.2, ease: "easeOut" }} className="text-center">
            <p className={cx("font-semibold uppercase tracking-[0.6em] text-violet", large ? "text-[2.4vh]" : "text-sm")}>21MOONS</p>
            <h2 className={cx("mt-4 font-semibold text-gradient", large ? "text-[9vh]" : "text-5xl")}>Final leaderboard</h2>
            <p className={cx("mt-3 text-mist", large ? "text-[2.4vh]" : "text-base")}>The freeze is lifted.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
