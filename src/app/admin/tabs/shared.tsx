"use client";

import type { AdminState } from "@/lib/server/state";
import { cx } from "@/components/ui";

export type AdminChallenge = AdminState["challenges"][number];
export type AdminSubmission = AdminState["submissions"][number];
export type AdminTeam = AdminState["teams"][number];

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-mist">{children}</h2>
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, onClick }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "warn" | "ok" | "cyan" | "violet"; onClick?: () => void }) {
  const t = tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : tone === "cyan" ? "text-cyan" : tone === "violet" ? "text-violet" : "text-silver";
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cx("panel flex flex-col items-start p-4 text-left", onClick && "transition hover:border-line-strong")}>
      <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">{label}</span>
      <span className={cx("mt-1 text-2xl font-semibold tabular", t)}>{value}</span>
      {sub && <span className="mt-0.5 text-xs text-mist">{sub}</span>}
    </Comp>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm text-silver">{label}</span>
        {hint && <span className="block text-xs text-dim">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition", checked ? "border-violet/60 bg-violet/40" : "border-line-strong bg-white/5")}
      >
        <span className={cx("absolute top-0.5 size-4.5 rounded-full bg-white transition-all", checked ? "left-[22px]" : "left-0.5")} style={{ width: 18, height: 18 }} />
      </button>
    </label>
  );
}
