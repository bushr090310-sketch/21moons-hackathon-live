"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Select } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/crm/form";
import { TAG_TYPES, labelOf } from "@/lib/crm/options";
import type { Tag } from "@/lib/crm/types";

export function TagAdmin({ tags, usage }: { tags: Tag[]; usage: Record<string, number> }) {
  const router = useRouter();
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("technology");
  const [err, setErr] = useState<string | null>(null);

  async function run(p: PromiseLike<{ error: unknown }>) {
    const { error } = await p;
    if (error) setErr(friendlyError(error));
    else { setErr(null); router.refresh(); }
  }
  const sb = () => supabase();
  const shown = tags.filter((t) => (!type || t.type === type) && t.name.toLowerCase().includes(q.toLowerCase()));
  const pending = tags.filter((t) => !t.approved);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} className="!h-9 !w-48" />
        <Select value={type} onChange={(e) => setType(e.target.value)} className="!h-9 !w-40">
          <option value="">All types</option>
          {TAG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
        {pending.length > 0 && <Button size="sm" variant="success" onClick={() => run(sb().from("tags").update({ approved: true }).eq("approved", false))}>Approve all {pending.length} pending</Button>}
        <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(sb().from("tags").insert({ type: newType, name: newName.trim(), approved: true })); setNewName(""); }}>
          <Select value={newType} onChange={(e) => setNewType(e.target.value)} className="!h-9 !w-32">
            {TAG_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Input required placeholder="New value" value={newName} onChange={(e) => setNewName(e.target.value)} className="!h-9 !w-40" maxLength={60} />
          <Button size="sm" type="submit" className="!h-9">Add</Button>
        </form>
      </div>
      {err && <p className="text-sm text-bad">{err}</p>}
      <div className="overflow-hidden rounded-xl border border-line bg-ink/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-dim">
            <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Used</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="px-3 py-1.5">
                  <input
                    defaultValue={t.name}
                    maxLength={60}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) void run(sb().from("tags").update({ name: v }).eq("id", t.id)); }}
                    className="w-full bg-transparent text-silver outline-none focus:underline"
                  />
                </td>
                <td className="px-3 py-1.5 text-mist">{labelOf(TAG_TYPES, t.type)}</td>
                <td className="px-3 py-1.5 tabular-nums text-mist">{usage[t.id] ?? 0}</td>
                <td className="px-3 py-1.5">{t.approved ? <Badge tone="ok">approved</Badge> : <Badge tone="warn">pending</Badge>}</td>
                <td className="px-3 py-1.5 text-right">
                  {!t.approved && <Button size="sm" variant="success" onClick={() => run(sb().from("tags").update({ approved: true }).eq("id", t.id))}>Approve</Button>}{" "}
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete “${t.name}”? It is removed from ${usage[t.id] ?? 0} profiles/projects.`)) void run(sb().from("tags").delete().eq("id", t.id)); }}>Delete</Button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-mist">No tags yet — they are added from profiles and projects.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
