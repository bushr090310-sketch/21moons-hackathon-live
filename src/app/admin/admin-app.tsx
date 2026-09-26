"use client";

import { Bell, BellOff, Flag, Gauge, Inbox, LogOut, Orbit, Settings, Trophy, Users, Vote } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminState } from "@/lib/server/state";
import { fmtTimeSec } from "@/lib/shared/time";
import { LivePill, Wordmark } from "@/components/brand";
import { useLiveData, useNow, type LiveData } from "@/components/live";
import { useToast } from "@/components/toast";
import { Button, Input, Label, Spinner, api, cx, useConfirm } from "@/components/ui";
import { Overview } from "./tabs/overview";
import { InboxTab } from "./tabs/inbox";
import { ChallengesTab } from "./tabs/challenges";
import { TeamsTab } from "./tabs/teams";
import { ScoresTab } from "./tabs/scores";
import { VotingTab } from "./tabs/voting";
import { SettingsTab } from "./tabs/settings";
import { UniverseTab } from "./tabs/universe";

export type Tab = "overview" | "inbox" | "challenges" | "teams" | "scores" | "voting" | "universe" | "settings";

export interface AdminCtx {
  s: AdminState;
  now: number;
  act: (payload: Record<string, unknown>, success?: string | ((result: unknown) => string | null)) => Promise<{ ok: boolean; result?: unknown }>;
  confirm: ReturnType<typeof useConfirm>["confirm"];
  go: (tab: Tab, opts?: { focus?: string }) => void;
  focus: string | null;
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Control", icon: Gauge },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "challenges", label: "Challenges", icon: Flag },
  { id: "teams", label: "Teams", icon: Users },
  { id: "scores", label: "Scores", icon: Trophy },
  { id: "voting", label: "Voting", icon: Vote },
  { id: "universe", label: "Universe", icon: Orbit },
  { id: "settings", label: "Settings", icon: Settings },
];

export function AdminApp() {
  const live = useLiveData<AdminState>("/api/admin/state", { channel: "admin", interval: 5000 });
  if (!live.data && live.status === null) return <Spinner label="Loading command center…" />;
  if (!live.data && (live.status === 401 || live.status === 503)) return <AdminLogin onDone={live.refresh} notConfigured={live.status === 503} message={live.error} />;
  if (!live.data) return <div className="p-6 text-center text-mist">{live.error ?? "Could not load"} <Button className="ml-2" onClick={() => void live.refresh()}>Retry</Button></div>;
  return <Command live={live as LiveData<AdminState> & { data: AdminState }} />;
}

function AdminLogin({ onDone, notConfigured, message }: { onDone: () => Promise<void>; notConfigured: boolean; message: string | null }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/login", { password: pw });
      setPw("");
      await onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <Wordmark size="lg" />
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.35em] text-violet">Organizer command center</p>
      {notConfigured ? (
        <p className="mt-4 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">{message ?? "ADMIN_PASSWORD is not configured on the server."} Set it in the deployment environment variables and redeploy.</p>
      ) : (
        <form onSubmit={submit} className="panel mt-4 flex flex-col gap-4 p-5">
          <label>
            <Label>Organizer password</Label>
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus required />
          </label>
          {err && <p className="text-sm text-bad">{err}</p>}
          <Button type="submit" variant="primary" size="lg" loading={busy}>Sign in</Button>
        </form>
      )}
    </main>
  );
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio not available */
  }
}

function Command({ live }: { live: LiveData<AdminState> & { data: AdminState } }) {
  const s = live.data;
  const now = useNow(live.serverOffset);
  const toast = useToast();
  const { confirm, node } = useConfirm();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const t = localStorage.getItem("moons-admin-tab") as Tab | null;
      if (t && TABS.some((x) => x.id === t)) return t;
    } catch { /* ignore */ }
    return "overview";
  });
  const [focus, setFocus] = useState<string | null>(null);
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem("moons-admin-sound") === "1"; } catch { return false; }
  });

  // NEW APPLICATION notifications
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const pending = s.submissions.filter((x) => x.status === "pending");
    if (!seen.current) {
      seen.current = new Set(pending.map((x) => x.id));
      return;
    }
    const fresh = pending.filter((x) => !seen.current!.has(x.id));
    pending.forEach((x) => seen.current!.add(x.id));
    if (fresh.length) {
      for (const f of fresh.slice(0, 3)) toast.info(`NEW APPLICATION — ${f.teamName}`, `${f.emoji} ${f.challengeTitle} · +${f.points}`);
      if (sound) beep();
    }
  }, [s.submissions, toast, sound]);

  useEffect(() => {
    document.title = s.stats.pending ? `(${s.stats.pending}) Command · 21MOONS` : "Command · 21MOONS";
  }, [s.stats.pending]);

  const go = useCallback((t: Tab, opts?: { focus?: string }) => {
    setTab(t);
    setFocus(opts?.focus ?? null);
    try { localStorage.setItem("moons-admin-tab", t); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  }, []);

  const act: AdminCtx["act"] = useCallback(async (payload, success) => {
    try {
      const res = await api<{ ok: boolean; result: unknown }>("/api/admin/action", payload);
      const msg = typeof success === "function" ? success(res.result) : success;
      if (msg) toast.success(msg);
      await live.refresh();
      return { ok: true, result: res.result };
    } catch (e) {
      toast.error((e as Error).message);
      await live.refresh();
      return { ok: false };
    }
  }, [toast, live]);

  const toggleSound = () => {
    const v = !sound;
    setSound(v);
    try { localStorage.setItem("moons-admin-sound", v ? "1" : "0"); } catch { /* ignore */ }
    if (v) beep();
  };

  const logout = async () => {
    await api("/api/admin/logout", {});
    location.reload();
  };

  const ctx: AdminCtx = { s, now, act, confirm, go, focus };

  return (
    <div className="min-h-dvh pb-24 sm:pb-10">
      <header className="sticky top-0 z-40 border-b border-line bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Wordmark size="sm" />
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.3em] text-violet sm:inline">Command</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden font-mono text-sm tabular text-mist sm:inline">{fmtTimeSec(new Date(now))}</span>
            <LivePill conn={live.conn} />
            {s.settings.frozen && <span className="rounded-full border border-cyan/40 bg-cyan/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan">Public frozen</span>}
            <button onClick={toggleSound} className="rounded-md p-2 text-mist hover:bg-white/5 hover:text-silver" title={sound ? "Sound on" : "Sound off"} aria-label="Toggle notification sound">
              {sound ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            </button>
            <button onClick={logout} className="rounded-md p-2 text-mist hover:bg-white/5 hover:text-silver" aria-label="Sign out"><LogOut className="size-4" /></button>
          </div>
        </div>
        <nav className="mx-auto hidden max-w-7xl gap-1 px-4 pb-2 sm:flex">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => go(t.id)} className={cx("relative inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition", tab === t.id ? "bg-white/[0.08] text-silver" : "text-mist hover:text-silver")}>
              <t.icon className="size-4" /> {t.label}
              {t.id === "inbox" && s.stats.pending > 0 && <span className="rounded-full bg-warn px-1.5 text-[11px] font-bold text-black">{s.stats.pending}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-5">
        {tab === "overview" && <Overview {...ctx} />}
        {tab === "inbox" && <InboxTab {...ctx} />}
        {tab === "challenges" && <ChallengesTab {...ctx} />}
        {tab === "teams" && <TeamsTab {...ctx} />}
        {tab === "scores" && <ScoresTab {...ctx} />}
        {tab === "voting" && <VotingTab {...ctx} />}
        {tab === "settings" && <SettingsTab {...ctx} />}
        {tab === "universe" && <UniverseTab {...ctx} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-void/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => go(t.id)} className={cx("relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]", tab === t.id ? "text-silver" : "text-dim")}>
            <t.icon className="size-5" />
            {t.label}
            {t.id === "inbox" && s.stats.pending > 0 && <span className="absolute right-[18%] top-1 rounded-full bg-warn px-1.5 text-[10px] font-bold text-black">{s.stats.pending}</span>}
          </button>
        ))}
      </nav>
      {node}
    </div>
  );
}
