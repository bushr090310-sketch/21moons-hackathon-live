"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; title: string; body?: string }

const Ctx = createContext<(kind: Kind, title: string, body?: string) => void>(() => {});

export function useToast() {
  const push = useContext(Ctx);
  return useMemo(() => ({
    success: (t: string, b?: string) => push("success", t, b),
    error: (t: string, b?: string) => push("error", t, b),
    info: (t: string, b?: string) => push("info", t, b),
  }), [push]);
}

let seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = ++seq;
    setToasts((t) => [...t.slice(-3), { id, kind, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 p-3 sm:items-end sm:p-5" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${
                t.kind === "success" ? "border-ok/30 bg-[#0c1a14]/90" : t.kind === "error" ? "border-bad/30 bg-[#1d0c12]/90" : "border-violet/30 bg-[#120f22]/90"
              }`}
            >
              {t.kind === "success" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : t.kind === "error" ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-bad" /> : <Info className="mt-0.5 size-5 shrink-0 text-violet" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-silver">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-mist">{t.body}</p>}
              </div>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-dim hover:text-silver" aria-label="Dismiss">
                <X className="size-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
