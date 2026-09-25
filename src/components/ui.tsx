"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; size?: "sm" | "md" | "lg" }>(
  function Button({ variant = "secondary", loading, size = "md", className, children, disabled, ...rest }, ref) {
    const v: Record<BtnVariant, string> = {
      primary: "bg-gradient-to-b from-[#b69cff] to-[#7c3aed] text-white shadow-[0_0_0_1px_rgb(167_139_250/0.4),0_8px_30px_-8px_rgb(124_58_237/0.7)] hover:brightness-110",
      secondary: "border border-line-strong bg-white/[0.04] text-silver hover:bg-white/[0.08]",
      ghost: "text-mist hover:bg-white/[0.06] hover:text-silver",
      danger: "border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20",
      success: "border border-ok/40 bg-ok/15 text-ok hover:bg-ok/25",
    };
    const s = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" }[size];
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cx("inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50", v[variant], s, className)}
        {...rest}
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        {children}
      </button>
    );
  },
);

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx("h-11 w-full rounded-lg border border-line-strong bg-black/30 px-3 text-silver placeholder:text-dim outline-none transition focus:border-violet/60 focus:ring-2 focus:ring-violet/20", className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx("w-full rounded-lg border border-line-strong bg-black/30 px-3 py-2.5 text-silver placeholder:text-dim outline-none transition focus:border-violet/60 focus:ring-2 focus:ring-violet/20", className)}
      {...rest}
    />
  );
});

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx("h-11 w-full rounded-lg border border-line-strong bg-ink px-3 text-silver outline-none focus:border-violet/60", className)}
      {...rest}
    />
  );
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium uppercase tracking-[0.12em] text-mist">
      <span>{children}</span>
      {hint && <span className="normal-case tracking-normal text-dim">{hint}</span>}
    </span>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "violet" | "cyan" | "ok" | "warn" | "bad"; children: React.ReactNode; className?: string }) {
  const t = {
    neutral: "border-line-strong text-mist bg-white/[0.03]",
    violet: "border-violet/40 text-violet bg-violet/10",
    cyan: "border-cyan/40 text-cyan bg-cyan/10",
    ok: "border-ok/40 text-ok bg-ok/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    bad: "border-bad/40 text-bad bg-bad/10",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider", t, className)}>{children}</span>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="no-print absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className={cx("relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-line-strong bg-ink p-5 shadow-2xl sm:rounded-2xl sm:p-6", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="text-lg font-semibold text-silver">{title}</div>
              <button onClick={onClose} className="no-print -m-1 rounded-md p-1 text-dim hover:bg-white/5 hover:text-silver" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Confirmation dialog for dangerous actions. Optional required text input (reason). */
export function useConfirm() {
  const [state, setState] = useState<null | {
    title: string; body?: React.ReactNode; confirmLabel?: string; danger?: boolean;
    input?: { label: string; placeholder?: string; required?: boolean; initial?: string };
    resolve: (v: { ok: boolean; value: string }) => void;
  }>(null);
  const [value, setValue] = useState("");

  const confirm = (opts: Omit<NonNullable<typeof state>, "resolve">) =>
    new Promise<{ ok: boolean; value: string }>((resolve) => {
      setValue(opts.input?.initial ?? "");
      setState({ ...opts, resolve });
    });

  const close = (ok: boolean) => {
    state?.resolve({ ok, value: value.trim() });
    setState(null);
  };

  const node = (
    <Modal open={!!state} onClose={() => close(false)} title={state?.title}>
      {state?.body && <div className="mb-4 text-sm text-mist">{state.body}</div>}
      {state?.input && (
        <label className="mb-4 block">
          <Label>{state.input.label}</Label>
          <Textarea rows={2} autoFocus value={value} placeholder={state.input.placeholder} onChange={(e) => setValue(e.target.value)} />
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
        <Button
          variant={state?.danger ? "danger" : "primary"}
          disabled={!!state?.input?.required && value.trim().length < 3}
          onClick={() => close(true)}
        >
          {state?.confirmLabel ?? "Confirm"}
        </Button>
      </div>
    </Modal>
  );
  return { confirm, node };
}

export function Empty({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="text-dim">{icon}</div>}
      <p className="text-sm font-medium text-mist">{title}</p>
      {children && <div className="text-sm text-dim">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-mist">
      <Loader2 className="size-5 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export async function api<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}
