"use client";

import { Maximize, Minimize, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicState } from "@/lib/shared/types";
import { fmtTime } from "@/lib/shared/time";
import { LivePill, SponsorStrip, Wordmark } from "@/components/brand";
import { ActivityFeed, DropOverlay, FrozenBanner, Leaderboard, NextDrop, RevealOverlay, useDropQueue } from "@/components/board";
import { useLiveData, useNow } from "@/components/live";
import { cx } from "@/components/ui";
import { CosmicBanner, LunarNetworkPanel, TakeoverLayer, UniverseBoundary, useUniverse } from "@/components/universe";

const PER_COLUMN = 13;

export function DisplayBoard({ initial }: { initial: PublicState | null }) {
  const { data, conn, serverOffset } = useLiveData<PublicState>("/api/public/state", { channel: "public", interval: 6000, initial });
  const now = useNow(serverOffset);
  const drops = useDropQueue(data?.challenges);
  const { u, refresh: refreshUniverse } = useUniverse(6000);
  const [isFs, setIsFs] = useState(false);
  const [idle, setIdle] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    let t: ReturnType<typeof setTimeout>;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000); };
    window.addEventListener("mousemove", wake);
    wake();
    return () => { document.removeEventListener("fullscreenchange", onFs); window.removeEventListener("mousemove", wake); clearTimeout(t); };
  }, []);

  const rows = data?.leaderboard ?? [];
  const pageSize = PER_COLUMN * 2;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages), 12000);
    return () => clearInterval(id);
  }, [pages]);
  const current = pages > 1 ? rows.slice((page % pages) * pageSize, (page % pages) * pageSize + pageSize) : rows;
  const twoCols = current.length > PER_COLUMN;
  const half = Math.ceil(current.length / 2);

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  const live = (data?.challenges ?? [])
    .filter((c) => c.state === "active")
    .sort((a, b) => new Date(b.revealAt ?? 0).getTime() - new Date(a.revealAt ?? 0).getTime())
    .slice(0, 4);

  return (
    <div className={cx("relative flex h-dvh flex-col overflow-hidden", idle && "cursor-none")}>
      <div className="pointer-events-none absolute -right-[20vh] -top-[30vh] size-[90vh] animate-orbit rounded-full border border-white/[0.05]">
        <span className="absolute left-1/2 top-0 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan/70 shadow-[0_0_18px_rgb(103_232_249/0.9)]" />
      </div>

      <header className="flex h-[11vh] shrink-0 items-center gap-[2vw] px-[3vw]">
        <Wordmark size="xl" className="!text-[3.4vh]" />
        <span className="h-[4vh] w-px bg-line-strong" />
        <span className="text-[2.2vh] font-semibold uppercase tracking-[0.45em] text-mist">Live leaderboard</span>
        <div className="ml-auto flex items-center gap-[1.6vw]">
          {data && <LivePill conn={conn} frozen={data.event.frozen} className="!px-[1.2vh] !py-[0.6vh] !text-[1.5vh]" />}
          <span className="text-[5vh] font-light tabular text-silver">{fmtTime(new Date(now))}</span>
          <button
            onClick={toggleFs}
            className={cx("rounded-lg border border-line p-2 text-mist transition hover:text-silver", idle && "opacity-0")}
            aria-label={isFs ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFs ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </button>
        </div>
      </header>

      {!data ? (
        <div className="flex flex-1 items-center justify-center text-[3vh] text-mist">Connecting…</div>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-[1fr_32vw] gap-[2vw] px-[3vw] pb-[2vh]">
          <section className="flex min-h-0 flex-col">
            {data.event.frozen && <div className="mb-[1.5vh]"><FrozenBanner frozenAt={data.event.frozenAt} large /></div>}
            {u?.cosmic && <UniverseBoundary><div className="mb-[1.5vh]"><CosmicBanner u={u} now={now} large /></div></UniverseBoundary>}
            {data.event.announcement && (
              <div className="mb-[1.5vh] flex items-center gap-3 rounded-xl border border-violet/30 bg-violet/[0.08] px-6 py-3 text-[2vh] text-silver">
                <Megaphone className="size-[2.4vh] text-violet" /> {data.event.announcement}
              </div>
            )}
            {rows.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[3vh] text-dim">Teams will appear here soon</div>
            ) : twoCols ? (
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-[1.2vw]">
                <Leaderboard rows={current.slice(0, half)} now={now} variant="display" statuses={u?.statuses} hideScores={u?.eclipse} />
                <Leaderboard rows={current.slice(half)} now={now} variant="display" statuses={u?.statuses} hideScores={u?.eclipse} />
              </div>
            ) : (
              <Leaderboard rows={current} now={now} variant="display" statuses={u?.statuses} hideScores={u?.eclipse} />
            )}
            {pages > 1 && <p className="mt-2 text-center text-[1.6vh] text-dim">Page {(page % pages) + 1} / {pages}</p>}
          </section>

          <aside className="flex min-h-0 flex-col gap-[2vh]">
            <NextDrop at={data.nextDropAt} now={now} large />
            <div className="panel p-[2.2vh]">
              <h2 className="mb-[1.6vh] text-[1.5vh] font-semibold uppercase tracking-[0.3em] text-mist">Live challenges</h2>
              {live.length ? (
                <ul className="flex flex-col gap-[1.4vh]">
                  {live.map((c) => (
                    <li key={c.id} className="flex items-center gap-[1vw]">
                      <span className="text-[3.2vh]">{c.emoji}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[2.2vh] font-medium text-silver">{c.title}</span>
                        {c.expiresAt && <span className="text-[1.5vh] text-warn">Ends {fmtTime(c.expiresAt)}</span>}
                      </span>
                      <span className="text-[2.4vh] font-semibold tabular text-cyan">+{c.points}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[1.8vh] text-dim">Stand by for the next drop.</p>
              )}
            </div>
            {u && <UniverseBoundary><LunarNetworkPanel feed={u.feed} now={now} large limit={4} /></UniverseBoundary>}
            <div className="panel min-h-0 flex-1 overflow-hidden p-[2.2vh]">
              <h2 className="mb-[1.6vh] text-[1.5vh] font-semibold uppercase tracking-[0.3em] text-mist">Recent activity</h2>
              <ActivityFeed items={data.activity} variant="display" limit={u ? 5 : 9} />
            </div>
          </aside>
        </main>
      )}

      {data && <SponsorStrip sponsors={data.event.sponsors} large className="shrink-0 !py-[2vh]" />}
      <DropOverlay challenge={drops.current} onDone={drops.dismiss} large autoMs={14000} />
      {data && <RevealOverlay revealedAt={data.event.revealedAt} now={now} large />}
      {u && <UniverseBoundary><TakeoverLayer u={u} now={now} refresh={refreshUniverse} /></UniverseBoundary>}
    </div>
  );
}
