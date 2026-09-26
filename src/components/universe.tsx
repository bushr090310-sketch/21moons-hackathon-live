"use client";

// 21MOONS UNIVERSE — optional presentation layer. Every piece renders nothing when the
// universe is off or its API fails, and is wrapped in an error boundary so it can
// never take down the leaderboard.
import { AnimatePresence, motion } from "framer-motion";
import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { UniversePublic, FeedItem } from "@/lib/server/universe/state";
import { TAKEOVER_SHOW_MS, buildTakeoverQueue, relTime } from "@/lib/shared/universe";
import { fmtCountdown, fmtTime } from "@/lib/shared/time";
import { useLiveData } from "./live";
import { cx } from "./ui";

export class UniverseBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("[universe ui]", e); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function useUniverse(interval = 8000) {
  const live = useLiveData<UniversePublic>("/api/universe/public", { channel: "public", interval });
  const u = live.data && live.data.enabled ? live.data : null;
  return { u, refresh: live.refresh, serverOffset: live.serverOffset };
}

const IMP: Record<FeedItem["importance"], string> = {
  normal: "border-line",
  hot: "border-violet/35",
  breaking: "border-bad/40",
};

export function OnAir({ large }: { large?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold uppercase text-mist", large ? "text-[1.5vh] tracking-[0.3em]" : "text-xs tracking-[0.25em]")}>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-bad/60" />
        <span className="relative inline-flex size-2 rounded-full bg-bad" />
      </span>
      Lunar Network live
    </span>
  );
}

export function LunarNetworkPanel({ feed, now, large, limit = 6, className }: { feed: FeedItem[]; now: number; large?: boolean; limit?: number; className?: string }) {
  return (
    <div className={cx("panel", large ? "p-[2.2vh]" : "p-4", className)}>
      <div className={cx("flex items-center justify-between", large ? "mb-[1.4vh]" : "mb-3")}>
        <OnAir large={large} />
        <span className={cx("text-dim", large ? "text-[1.4vh]" : "text-[11px]")}>📡</span>
      </div>
      {feed.length === 0 ? (
        <p className={cx("text-dim", large ? "text-[1.8vh]" : "text-sm")}>Scanning the galaxy… news appears here.</p>
      ) : (
        <ul className={cx("flex flex-col", large ? "gap-[1.1vh]" : "gap-2.5")}>
          <AnimatePresence initial={false}>
            {feed.slice(0, limit).map((f) => (
              <motion.li key={f.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className={cx("border-l-2 pl-3", IMP[f.importance])}>
                <div className="flex items-start gap-2">
                  <span className={large ? "text-[2.2vh]" : "text-base"}>{f.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cx("font-semibold leading-snug text-silver", large ? "text-[1.8vh]" : "text-[13px]")}>
                      {f.importance === "breaking" && <span className="mr-1.5 text-bad">BREAKING</span>}
                      {f.headline}
                    </p>
                    {f.body && <p className={cx("truncate text-mist", large ? "text-[1.5vh]" : "text-xs")}>{f.body}</p>}
                  </div>
                  <span className={cx("shrink-0 tabular", relTime(f.createdAt, now) === "NOW" ? "font-semibold text-bad" : "text-dim", large ? "text-[1.4vh]" : "text-[11px]")}>
                    {relTime(f.createdAt, now)}
                  </span>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

/** Mobile: one compact line with the latest item. */
export function LunarTicker({ feed, now }: { feed: FeedItem[]; now: number }) {
  const f = feed[0];
  if (!f) return null;
  return (
    <div className="flex items-center gap-2 overflow-hidden rounded-xl border border-line bg-white/[0.03] px-3 py-2 text-xs">
      <span className="relative flex size-1.5 shrink-0"><span className="absolute inline-flex size-full animate-ping rounded-full bg-bad/60" /><span className="relative inline-flex size-1.5 rounded-full bg-bad" /></span>
      <span className="shrink-0 font-semibold uppercase tracking-wider text-mist">📡</span>
      <span className="min-w-0 flex-1 truncate text-silver">{f.emoji} {f.headline}</span>
      <span className="shrink-0 tabular text-dim">{relTime(f.createdAt, now)}</span>
    </div>
  );
}

/** Active cosmic event, explained plainly. Buildup shows only a countdown (event stays secret). */
export function CosmicBanner({ u, now, large }: { u: UniversePublic; now: number; large?: boolean }) {
  const c = u.cosmic;
  if (!c) return null;
  if (c.phase === "buildup") {
    return (
      <div className={cx("flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/[0.08] text-warn", large ? "px-6 py-3 text-[2vh]" : "px-4 py-3 text-sm")}>
        <span>⚠️</span>
        <span className="flex-1 font-semibold uppercase tracking-wider">Cosmic anomaly detected</span>
        <span className="font-semibold tabular">{fmtCountdown(new Date(c.goesLiveAt).getTime() - now)}</span>
      </div>
    );
  }
  return (
    <div className={cx("flex items-center gap-3 rounded-xl border border-violet/40 bg-violet/[0.08]", large ? "px-6 py-3" : "px-4 py-3")}>
      <span className={large ? "text-[3vh]" : "text-xl"}>{c.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className={cx("font-semibold uppercase tracking-wider text-silver", large ? "text-[2vh]" : "text-sm")}>{c.title}{c.points ? <span className="ml-2 text-cyan">+{c.points} pts</span> : null}</p>
        <p className={cx("text-mist", large ? "text-[1.6vh]" : "text-xs")}>{c.explanation}{c.challengeTitle ? ` · ${c.challengeTitle}` : ""}</p>
      </div>
      {c.endsAt && <span className={cx("shrink-0 tabular text-mist", large ? "text-[2vh]" : "text-xs")}>ends {fmtTime(c.endsAt)} · {fmtCountdown(new Date(c.endsAt).getTime() - now)}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projector takeovers
// ---------------------------------------------------------------------------
const SEEN_KEY = "moons-universe-seen";

function loadSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
function saveSeen(s: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200))); } catch { /* ignore */ }
}

type Show = { key: string; kind: "news"; item: FeedItem } | { key: string; kind: "reveal"; cosmic: NonNullable<UniversePublic["cosmic"]> };

/**
 * Full-screen takeovers for /display: queued news takeovers, the anomaly countdown,
 * and the cosmic reveal. Each item is shown once per screen (seen-set in localStorage),
 * so reconnects/refreshes never replay. Returns to the leaderboard automatically.
 */
export function TakeoverLayer({ u, now, refresh }: { u: UniversePublic; now: number; refresh: () => Promise<void> }) {
  const seen = useRef<Set<string> | null>(null);
  const [current, setCurrent] = useState<Show | null>(null);
  const queue = useRef<Show[]>([]);

  const advance = useCallback(() => {
    const next = queue.current.shift() ?? null;
    setCurrent(next);
  }, []);

  useEffect(() => {
    seen.current ??= loadSeen();
    const s = seen.current;
    const add: Show[] = [];
    const c = u.cosmic;
    if (c && c.phase === "active" && !s.has(`reveal:${c.id}`) && now - new Date(c.goesLiveAt).getTime() < 120_000) {
      add.push({ key: `reveal:${c.id}`, kind: "reveal", cosmic: c });
    }
    // The cosmic reveal overlay replaces its own news takeover.
    const items = buildTakeoverQueue(u.takeovers.filter((t) => t.type !== "COSMIC_EVENT" && t.type !== "ANOMALY"), s, now);
    for (const it of items) add.push({ key: it.id, kind: "news", item: it });
    const fresh = add.filter((a) => !queue.current.some((q) => q.key === a.key) && current?.key !== a.key);
    if (!fresh.length) return;
    fresh.forEach((f) => s.add(f.key));
    saveSeen(s);
    queue.current.push(...fresh);
    if (!current) {
      const t = setTimeout(advance, 0);
      return () => clearTimeout(t);
    }
  }, [u, now, current, advance]);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(advance, current.kind === "reveal" ? 8000 : TAKEOVER_SHOW_MS);
    return () => clearTimeout(t);
  }, [current, advance]);

  // Countdown hits zero → fetch the reveal right away.
  const goes = u.cosmic?.phase === "buildup" ? new Date(u.cosmic.goesLiveAt).getTime() : null;
  useEffect(() => {
    if (goes == null) return;
    const ms = goes - Date.now();
    const t = setTimeout(() => void refresh(), Math.max(0, ms) + 800);
    return () => clearTimeout(t);
  }, [goes, refresh]);

  const buildup = u.cosmic?.phase === "buildup" ? u.cosmic : null;
  return (
    <>
      <AnimatePresence>
        {buildup && !current && (
          <motion.div key="anomaly" className="fixed inset-0 z-[92] flex items-center justify-center bg-black/85 backdrop-blur-md"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.8 } }}>
            <motion.div className="absolute size-[80vmin] rounded-full border border-warn/20" animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.2, 0.5] }} transition={{ duration: 2.4, repeat: Infinity }} />
            <div className="relative text-center">
              <motion.p animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.2, repeat: Infinity }} className="text-[3vh] font-semibold uppercase tracking-[0.5em] text-warn">⚠️ Cosmic anomaly detected</motion.p>
              <p className="mt-[2vh] text-[2.4vh] uppercase tracking-[0.3em] text-mist">Unknown activity in the 21MOONS universe</p>
              <p className="mt-[4vh] text-[16vh] font-light leading-none tabular text-silver">{fmtCountdown(buildup ? new Date(buildup.goesLiveAt).getTime() - now : 0)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {current && (
          <motion.div key={current.key} className="fixed inset-0 z-[94] flex items-center justify-center bg-black/80 p-[4vh] backdrop-blur-md"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={advance}>
            <motion.div className="absolute size-[70vmin] rounded-full border border-violet/30" initial={{ scale: 0.3, opacity: 0.9 }} animate={{ scale: 1.7, opacity: 0 }} transition={{ duration: 1.8, ease: "easeOut" }} />
            {current.kind === "news" ? <NewsCard item={current.item} /> : <RevealCard c={current.cosmic} />}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function NewsCard({ item }: { item: FeedItem }) {
  const [kicker, ...rest] = item.headline.split(" — ");
  const main = rest.length ? rest.join(" — ") : kicker;
  return (
    <motion.div initial={{ y: 30, scale: 0.94, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ type: "spring", damping: 20, stiffness: 180 }}
      className="relative w-full max-w-[70vw] rounded-3xl border border-violet/40 bg-gradient-to-b from-[#16112b] to-[#0a0c13] p-[5vh] text-center shadow-[0_0_120px_-20px_rgb(124_58_237/0.7)]">
      <p className="text-[2vh] font-semibold uppercase tracking-[0.5em] text-violet">📡 Lunar Network</p>
      <div className="mt-[3vh] text-[11vh] leading-none">{item.emoji}</div>
      {rest.length > 0 && <p className="mt-[2vh] text-[3vh] font-semibold uppercase tracking-[0.3em] text-mist">{kicker}</p>}
      <h2 className="mt-[1.5vh] text-[5.6vh] font-semibold leading-tight text-gradient">{main}</h2>
      {item.body && <p className={cx("mt-[2vh] text-[3.4vh] font-semibold", item.points != null && item.points < 0 ? "text-bad" : "text-cyan")}>{item.body}</p>}
    </motion.div>
  );
}

function RevealCard({ c }: { c: NonNullable<UniversePublic["cosmic"]> }) {
  return (
    <motion.div initial={{ scale: 0.6, opacity: 0, filter: "blur(12px)" }} animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }} transition={{ duration: 1.1, ease: "easeOut" }}
      className="relative w-full max-w-[70vw] rounded-3xl border border-cyan/40 bg-gradient-to-b from-[#0d1a22] to-[#0a0c13] p-[5vh] text-center shadow-[0_0_140px_-20px_rgb(6_182_212/0.6)]">
      <p className="text-[2vh] font-semibold uppercase tracking-[0.5em] text-cyan">🌌 Cosmic event</p>
      <div className="mt-[3vh] text-[12vh] leading-none">{c.emoji}</div>
      <h2 className="mt-[2vh] text-[7vh] font-semibold uppercase leading-tight text-gradient">{c.title} event</h2>
      <p className="mx-auto mt-[2vh] max-w-[55vw] text-[3vh] text-silver">{c.explanation}</p>
      {c.challengeTitle && <p className="mt-[1.5vh] text-[2.6vh] text-mist">New challenge: <b className="text-silver">{c.challengeTitle}</b></p>}
      <div className="mt-[3vh] flex items-center justify-center gap-[2vw] text-[3vh] font-semibold">
        {c.points ? <span className="text-cyan">+{c.points} PTS</span> : null}
        {c.endsAt && <span className="text-mist">until {fmtTime(c.endsAt)}</span>}
      </div>
    </motion.div>
  );
}
