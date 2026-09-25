"use client";

import Link from "next/link";
import { Flag } from "lucide-react";
import type { PublicChallenge, PublicState } from "@/lib/shared/types";
import { LivePill, SiteHeader, SponsorStrip } from "@/components/brand";
import { DropOverlay, NextDrop, useDropQueue } from "@/components/board";
import { ChallengeCard } from "@/components/challenge-card";
import { useLiveData, useNow } from "@/components/live";
import { Empty, Spinner } from "@/components/ui";

export function groupChallenges(list: PublicChallenge[], now: number) {
  const endingSoon: PublicChallenge[] = [];
  const liveNow: PublicChallenge[] = [];
  const finals: PublicChallenge[] = [];
  const done: PublicChallenge[] = [];
  for (const c of list) {
    if (c.state === "active") {
      const ms = c.expiresAt ? new Date(c.expiresAt).getTime() - now : null;
      if (ms != null && ms > 0 && ms < 60 * 60_000 && c.acceptsSubmissions) endingSoon.push(c);
      else if (!c.acceptsSubmissions) finals.push(c);
      else liveNow.push(c);
    } else {
      done.push(c);
    }
  }
  return { endingSoon, liveNow, finals, done };
}

function Section({ title, hint, items, now }: { title: string; hint?: string; items: PublicChallenge[]; now: number }) {
  if (!items.length) return null;
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-mist">{title}</h2>
        <span className="text-xs text-dim">{items.length}</span>
        {hint && <span className="ml-auto text-xs text-dim">{hint}</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((c) => <ChallengeCard key={c.id} c={c} now={now} />)}
      </div>
    </section>
  );
}

export function ChallengesView({ initial }: { initial: PublicState | null }) {
  const { data, conn, serverOffset, error } = useLiveData<PublicState>("/api/public/state", { channel: "public", interval: 10000, initial });
  const now = useNow(serverOffset);
  const drops = useDropQueue(data?.challenges);
  if (!data) return (<><SiteHeader />{error ? <div className="p-6"><Empty title="Couldn't load challenges">{error}</Empty></div> : <Spinner />}</>);
  const g = groupChallenges(data.challenges, now);
  return (
    <>
      <SiteHeader right={<LivePill conn={conn} frozen={data.event.frozen} />} />
      <main className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:pt-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-violet">{data.event.name}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gradient sm:text-5xl">Challenges</h1>
            <p className="mt-2 max-w-xl text-sm text-mist">New challenges drop during the day. Apply from your <Link href="/team" className="text-violet hover:underline">team dashboard</Link>.</p>
          </div>
          <div className="w-full sm:w-80"><NextDrop at={data.nextDropAt} now={now} /></div>
        </div>
        {data.challenges.length === 0 && <Empty icon={<Flag className="size-6" />} title="No challenges revealed yet">The first challenges appear when the event starts.</Empty>}
        <Section title="Ending soon" items={g.endingSoon} now={now} />
        <Section title="Live now" items={g.liveNow} now={now} />
        <Section title="Final awards" hint="Decided by the jury or by People's Choice" items={g.finals} now={now} />
        <Section title="Completed / claimed" items={g.done} now={now} />
      </main>
      <SponsorStrip sponsors={data.event.sponsors} />
      <DropOverlay challenge={drops.current} onDone={drops.dismiss} />
    </>
  );
}
