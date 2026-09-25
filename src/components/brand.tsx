"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ConnState } from "./live";
import { cx } from "./ui";

export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const s = { sm: "text-sm tracking-[0.32em]", md: "text-base tracking-[0.36em]", lg: "text-2xl tracking-[0.4em]", xl: "text-4xl tracking-[0.42em]" }[size];
  return (
    <span className={cx("inline-flex items-center gap-2.5 font-semibold text-silver", s, className)}>
      <MoonGlyph className={size === "xl" ? "size-8" : size === "lg" ? "size-6" : "size-4"} />
      <span>21MOONS</span>
    </span>
  );
}

export function MoonGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="0.8" />
      <circle cx="12" cy="12" r="6" fill="url(#mg)" />
      <circle cx="14.6" cy="10" r="5.2" fill="#04050a" />
      <circle cx="21.5" cy="9" r="1.2" fill="#67e8f9" />
    </svg>
  );
}

export function LivePill({ conn, frozen, className }: { conn: ConnState; frozen?: boolean; className?: string }) {
  if (frozen) {
    return (
      <span className={cx("inline-flex items-center gap-2 rounded-full border border-cyan/40 bg-cyan/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan", className)}>
        <span className="size-1.5 rounded-full bg-cyan" /> Frozen
      </span>
    );
  }
  const map = {
    live: { dot: "bg-ok animate-pulse-dot", text: "Live", cls: "border-ok/30 text-ok bg-ok/10" },
    polling: { dot: "bg-ok animate-pulse-dot", text: "Live", cls: "border-ok/30 text-ok bg-ok/10" },
    offline: { dot: "bg-warn", text: "Reconnecting", cls: "border-warn/40 text-warn bg-warn/10" },
  }[conn];
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]", map.cls, className)} title={conn === "polling" ? "Auto-refreshing" : conn === "live" ? "Realtime connected" : "Connection lost"}>
      <span className={cx("size-1.5 rounded-full", map.dot)} /> {map.text}
    </span>
  );
}

const NAV = [
  { href: "/", label: "Leaderboard" },
  { href: "/challenges", label: "Challenges" },
  { href: "/team", label: "Team" },
  { href: "/vote", label: "Vote" },
];

export function SiteHeader({ right }: { right?: React.ReactNode }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-void/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" aria-label="21MOONS home"><Wordmark size="sm" /></Link>
        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cx("rounded-md px-3 py-1.5 text-sm transition", path === n.href ? "bg-white/[0.07] text-silver" : "text-mist hover:text-silver")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:ml-2">{right}</div>
      </div>
      <nav className="flex border-t border-line sm:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cx("flex-1 py-2.5 text-center text-[13px]", path === n.href ? "text-silver" : "text-dim")}>
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SponsorStrip({ sponsors, className, large }: { sponsors: string[]; className?: string; large?: boolean }) {
  if (!sponsors.length) return null;
  const items = [...sponsors, ...sponsors];
  return (
    <div className={cx("relative overflow-hidden border-t border-line py-3", className)} aria-label="Partners">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-void to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-void to-transparent" />
      <div className="flex w-max animate-marquee items-center">
        {items.map((s, i) => (
          <span key={i} className={cx("flex items-center whitespace-nowrap font-medium uppercase text-mist/80", large ? "px-10 text-xl tracking-[0.28em]" : "px-7 text-xs tracking-[0.3em]")}>
            {s}
            <span className={cx("ml-10 inline-block rounded-full bg-violet/50", large ? "size-1.5" : "size-1")} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function OrbitBackdrop({ className }: { className?: string }) {
  return (
    <div className={cx("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div className="absolute -right-40 -top-40 size-[640px] animate-orbit rounded-full border border-white/[0.05]">
        <span className="absolute left-1/2 top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan/70 shadow-[0_0_12px_rgb(103_232_249/0.8)]" />
      </div>
      <div className="absolute -right-20 -top-20 size-[400px] rounded-full border border-white/[0.04]" />
    </div>
  );
}
