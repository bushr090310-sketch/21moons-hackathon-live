export function Chips({ items, max = 6 }: { items: string[]; max?: number }) {
  if (!items.length) return <span className="text-dim">—</span>;
  return (
    <div className="flex max-w-[16rem] flex-wrap gap-1">
      {items.slice(0, max).map((t) => (
        <span key={t} className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-mist">{t}</span>
      ))}
      {items.length > max && <span className="text-[11px] text-dim">+{items.length - max}</span>}
    </div>
  );
}
