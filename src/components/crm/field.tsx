import { Label } from "@/components/ui";

export function Field({ label, hint, children, className = "" }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <Label hint={hint}>{label}</Label>
      {children}
    </label>
  );
}

export function Section({ n, title, children, desc }: { n: number; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-ink/70 p-5">
      <h2 className="text-sm font-semibold text-silver">
        <span className="mr-2 text-dim">{n}.</span>
        {title}
      </h2>
      {desc && <p className="mt-0.5 text-xs text-dim">{desc}</p>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function CheckGroup({ options, value, onChange }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={`rounded-full border px-3 py-1 text-sm transition ${on ? "border-violet/60 bg-violet/15 text-silver" : "border-line-strong text-mist hover:text-silver"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
