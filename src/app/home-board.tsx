"use client";

import Link from "next/link";
import { ArrowRight, Megaphone, Monitor, Trophy } from "lucide-react";
import type { PublicState } from "@/lib/shared/types";
import { fmtTime } from "@/lib/shared/time";
import { LivePill, OrbitBackdrop, SiteHeader, SponsorStrip } from "@/components/brand";
import { ActivityFeed, DropOverlay, FrozenBanner, Leaderboard, NextDrop, RevealOverlay, useDropQueue } from "@/components/board";
import { useLiveData, useNow } from "@/components/live";
import { Empty, Spinner } from "@/components/ui";
import { CosmicBanner, LunarNetworkPanel, LunarTicker, UniverseBoundary, useUniverse } from "@/components/universe";

export function HomeBoard({ initial }: { initial: PublicState | null }) {
  const { data, conn, serverOffset, error } = useLiveData<PublicState>("/api/public/state", { channel: "public", interval: 8000, initial });
  const now = useNow(serverOffset);
  const drops = useDropQueue(data?.challenges);
  const { u } = useUniverse();

  if (!data) {
    return (
      <>
        <SiteHeader />
        {error ? <div className="mx-auto max-w-6xl p-6"><Empty title="Leaderboard is temporarily unavailable">{error}</Empty></div> : <Spinner />}
      </>
    );
  }
  const live = data.challenges.filter((c) => c.state === "active").slice(0, 6);
  return (
    <>
      <SiteHeader right={<LivePill conn={conn} frozen={data.event.frozen} />} />
      <main className="relative mx-auto max-w-6xl px-4 pb-10 pt-6 sm:pt-10">
        <OrbitBackdrop className="-z-10" />
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-violet">{data.event.name} · {data.event.location}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gradient sm:text-5xl">Live leaderboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-light tabular text-silver/90 sm:text-4xl">{fmtTime(new Date(now))}</span>
            <Link href="/display" className="hidden items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs text-mist hover:text-silver sm:inline-flex">
              <Monitor className="size-4" /> Projector
            </Link>
          </div>
        </div>

        {data.event.announcement && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-violet/30 bg-violet/[0.08] px-4 py-3 text-sm text-silver">
            <Megaphone className="size-4 shrink-0 text-violet" /> {data.event.announcement}
          </div>
        )}
        {data.event.frozen && <div className="mb-4"><FrozenBanner frozenAt={data.event.frozenAt} /></div>}
        {u && (
          <UniverseBoundary>
            {u.cosmic && <div className="mb-4"><CosmicBanner u={u} now={now} /></div>}
            <div className="mb-4 lg:hidden"><LunarTicker feed={u.feed} now={now} /></div>
          </UniverseBoundary>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <section aria-label="Leaderboard">
            {data.leaderboard.length ? (
              <Leaderboard rows={data.leaderboard} now={now} statuses={u?.statuses} hideScores={u?.eclipse} />
            ) : (
              <Empty icon={<Trophy className="size-6" />} title="Teams will appear here once the event starts" />
            )}
            <p className="mt-3 text-xs text-dim">Equal scores: the team that reached the score first is listed first.</p>
          </section>

          <aside className="flex flex-col gap-4">
            <NextDrop at={data.nextDropAt} now={now} />
            {u && <UniverseBoundary><LunarNetworkPanel feed={u.feed} now={now} limit={6} className="hidden lg:block" /></UniverseBoundary>}
            <div className="panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-mist">Live challenges</h2>
                <Link href="/challenges" className="inline-flex items-center gap-1 text-xs text-violet hover:underline">All <ArrowRight className="size-3" /></Link>
              </div>
              {live.length ? (
                <ul className="flex flex-col gap-2.5">
                  {live.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 text-sm">
                      <span className="text-lg">{c.emoji}</span>
                      <span className="min-w-0 flex-1 truncate text-silver">{c.title}</span>
                      {c.expiresAt && <span className="text-xs text-warn">until {fmtTime(c.expiresAt)}</span>}
                      <span className="font-semibold tabular text-cyan">+{c.points}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-dim">No live challenges right now.</p>
              )}
            </div>
            <div className="panel p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-mist">Recent activity</h2>
              <ActivityFeed items={data.activity} limit={10} />
            </div>
            {data.voteResults && (
              <div className="panel p-4">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-mist">People&apos;s Choice votes</h2>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.voteResults.map((v) => (
                    <li key={v.teamId} className="flex justify-between"><span>{v.name}</span><span className="tabular text-cyan">{v.votes}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </main>
      <SponsorStrip sponsors={data.event.sponsors} />
      <DropOverlay challenge={drops.current} onDone={drops.dismiss} />
      <RevealOverlay revealedAt={data.event.revealedAt} now={now} />
    </>
  );
}
