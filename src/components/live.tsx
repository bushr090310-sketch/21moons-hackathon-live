"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type Channel = "public" | "admin";
type RealtimeStatus = "off" | "connecting" | "live" | "down";

interface LiveCtx {
  subscribe: (channel: Channel, cb: () => void) => () => void;
  realtime: RealtimeStatus;
}

const Ctx = createContext<LiveCtx>({ subscribe: () => () => {}, realtime: "off" });

/**
 * Supabase Realtime is used purely as an invalidation signal on the data-free
 * `live_signals` table. Every consumer ALSO polls, so the app keeps working if
 * Realtime is unavailable.
 */
export function LiveProvider({ realtime, children }: { realtime: { url: string; key: string } | null; children: React.ReactNode }) {
  const listeners = useRef(new Map<Channel, Set<() => void>>());
  const [status, setStatus] = useState<RealtimeStatus>(realtime ? "connecting" : "off");
  const clientRef = useRef<SupabaseClient | null>(null);

  useEffect(() => {
    if (!realtime) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const client = createClient(realtime.url, realtime.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
    clientRef.current = client;

    const connect = () => {
      if (cancelled) return;
      const ch = client
        .channel("live-signals")
        .on("postgres_changes", { event: "*", schema: "public", table: "live_signals" }, (payload) => {
          const row = (payload.new ?? {}) as { channel?: Channel };
          const set = row.channel ? listeners.current.get(row.channel) : undefined;
          set?.forEach((fn) => fn());
        })
        .subscribe((s) => {
          if (cancelled) return;
          if (s === "SUBSCRIBED") setStatus("live");
          else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            setStatus("down");
            client.removeChannel(ch);
            retry = setTimeout(connect, 5000);
          }
        });
    };
    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      client.removeAllChannels();
    };
  }, [realtime]);

  const subscribe = useCallback((channel: Channel, cb: () => void) => {
    const set = listeners.current.get(channel) ?? new Set();
    set.add(cb);
    listeners.current.set(channel, set);
    return () => set.delete(cb);
  }, []);

  return <Ctx.Provider value={{ subscribe, realtime: status }}>{children}</Ctx.Provider>;
}

export type ConnState = "live" | "polling" | "offline";

export interface LiveData<T> {
  data: T | null;
  error: string | null;
  status: number | null;
  conn: ConnState;
  refresh: () => Promise<void>;
  serverOffset: number;
}

/**
 * Fetch JSON, refresh on realtime signals, poll as fallback, refresh on focus /
 * reconnect. Poll interval tightens when realtime is not connected.
 */
export function useLiveData<T>(url: string | null, opts: { channel?: Channel; interval?: number; initial?: T | null } = {}): LiveData<T> {
  const { subscribe, realtime } = useContext(Ctx);
  const [data, setData] = useState<T | null>(opts.initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [failing, setFailing] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const inflight = useRef(false);
  const queued = useRef(false);
  const again = useRef<() => void>(() => {});

  const refresh = useCallback(async () => {
    if (!url) return;
    if (inflight.current) { queued.current = true; return; }
    inflight.current = true;
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      setStatus(res.status);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Request failed (${res.status})`);
        setFailing(res.status >= 500);
        if (res.status === 401) setData(null);
      } else {
        setData(body as T);
        setError(null);
        setFailing(false);
        const st = (body as { serverTime?: string })?.serverTime;
        if (st) setServerOffset(new Date(st).getTime() - Date.now());
      }
    } catch {
      setFailing(true);
      setError("Connection problem — retrying…");
    } finally {
      inflight.current = false;
      if (queued.current) { queued.current = false; again.current(); }
    }
  }, [url]);

  useEffect(() => {
    again.current = () => void refresh();
  }, [refresh]);

  useEffect(() => {
    // Initial fetch (deferred to satisfy the effect-setState lint rule).
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    if (!opts.channel) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = subscribe(opts.channel, () => {
      // Debounce bursts of changes.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [opts.channel, subscribe, refresh]);

  const base = opts.interval ?? 10000;
  const interval = realtime === "live" ? Math.max(base, 15000) : base;
  useEffect(() => {
    const id = setInterval(() => void refresh(), failing ? Math.min(interval, 5000) : interval);
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, interval, failing]);

  const conn: ConnState = failing ? "offline" : realtime === "live" ? "live" : "polling";
  return { data, error, status, conn, refresh, serverOffset };
}

/** Ticking clock aligned to server time. */
export function useNow(offset = 0, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), everyMs);
    return () => clearInterval(id);
  }, [offset, everyMs]);
  return now;
}
