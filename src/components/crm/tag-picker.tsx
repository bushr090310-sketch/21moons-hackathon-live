"use client";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { cx } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/crm/form";
import type { TagType } from "@/lib/crm/options";
import type { Tag } from "@/lib/crm/types";

// Searchable controlled list with "suggest a new one". New tags are created
// unapproved (RLS: tags_insert) and are usable right away by the person who added them.
export function TagPicker({
  type, tags, selected, onChange, onCreated, placeholder,
}: {
  type: TagType;
  tags: Tag[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onCreated: (t: Tag) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ofType = useMemo(() => tags.filter((t) => t.type === type), [tags, type]);
  const byId = useMemo(() => new Map(ofType.map((t) => [t.id, t])), [ofType]);
  const term = q.trim().toLowerCase();
  const matches = ofType
    .filter((t) => !selected.includes(t.id) && (!term || t.name.toLowerCase().includes(term)))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(term)) - Number(a.name.toLowerCase().startsWith(term)) || a.name.localeCompare(b.name))
    .slice(0, 8);
  const exact = ofType.find((t) => t.name.toLowerCase() === term);

  function add(id: string) {
    onChange([...selected, id]);
    setQ("");
  }

  async function create() {
    const name = q.trim().slice(0, 60);
    if (!name) return;
    setErr(null);
    const { data, error } = await supabase().from("tags").insert({ type, name }).select("id, type, name, approved").single();
    if (error) {
      setErr(friendlyError(error));
      return;
    }
    onCreated(data as Tag);
    add((data as Tag).id);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (exact && !selected.includes(exact.id)) add(exact.id);
      else if (matches[0] && term) add(matches[0].id);
      else if (term && !exact) void create();
    } else if (e.key === "Backspace" && !q && selected.length) {
      onChange(selected.slice(0, -1));
    }
  }

  return (
    <div className="relative">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-black/30 px-2 py-1.5 focus-within:border-violet/60">
        {selected.map((id) => {
          const t = byId.get(id);
          return (
            <span key={id} className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs", t?.approved === false ? "border-warn/40 text-warn" : "border-line-strong text-silver")}>
              {t?.name ?? "…"}
              {t?.approved === false && <span className="text-[10px] opacity-70">pending</span>}
              <button type="button" onClick={() => onChange(selected.filter((s) => s !== id))} aria-label={`Remove ${t?.name}`}>
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          placeholder={selected.length ? "" : placeholder ?? "Search or add…"}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-silver outline-none placeholder:text-dim"
        />
      </div>
      {open && (matches.length > 0 || (term && !exact)) && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-line-strong bg-ink-2 shadow-xl">
          {matches.map((t) => (
            <button key={t.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(t.id)} className="block w-full px-3 py-1.5 text-left text-sm text-silver hover:bg-white/[0.06]">
              {t.name}
            </button>
          ))}
          {term && !exact && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={create} className="block w-full border-t border-line px-3 py-1.5 text-left text-sm text-violet hover:bg-white/[0.06]">
              + Add “{q.trim()}” (reviewed by 21Moons)
            </button>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  );
}
