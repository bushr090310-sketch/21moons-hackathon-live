"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { Field } from "@/components/crm/field";
import { supabase } from "@/lib/supabase/client";
import { friendlyError, str } from "@/lib/crm/form";
import { HACKATHON_STATUS } from "@/lib/crm/options";

type H = { id?: string; slug?: string; name?: string; starts_on?: string | null; ends_on?: string | null; location?: string | null; description?: string | null; status?: string };

const slugify = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// Admin-only (RLS hackathons_admin).
export function HackathonForm({ hackathon, onDone }: { hackathon?: H; onDone?: () => void }) {
  const router = useRouter();
  const [h, setH] = useState<H>(hackathon ?? { status: "upcoming" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof H) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setH({ ...h, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const row = {
      name: (h.name ?? "").trim(),
      slug: str(h.slug) ?? slugify(`${h.name ?? ""} ${h.starts_on ?? ""}`),
      starts_on: str(h.starts_on), ends_on: str(h.ends_on), location: str(h.location), description: str(h.description),
      status: h.status ?? "upcoming",
    };
    const sb = supabase();
    const res = h.id ? await sb.from("hackathons").update(row).eq("id", h.id).select("id").single() : await sb.from("hackathons").insert(row).select("id").single();
    setBusy(false);
    if (res.error) return setError(friendlyError(res.error));
    onDone?.();
    if (!h.id) router.push(`/hackathons/${res.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
      <Field label="Name *" className="md:col-span-2"><Input value={h.name ?? ""} onChange={set("name")} required maxLength={200} /></Field>
      <Field label="Starts"><Input type="date" value={h.starts_on ?? ""} onChange={set("starts_on")} /></Field>
      <Field label="Ends"><Input type="date" value={h.ends_on ?? ""} onChange={set("ends_on")} /></Field>
      <Field label="Location"><Input value={h.location ?? ""} onChange={set("location")} /></Field>
      <Field label="Status">
        <Select value={h.status} onChange={set("status")}>{HACKATHON_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
      </Field>
      <Field label="Slug" hint="auto if empty" className="md:col-span-2"><Input value={h.slug ?? ""} onChange={set("slug")} pattern="[a-z0-9-]+" /></Field>
      <Field label="Description" className="md:col-span-2"><Textarea rows={2} value={h.description ?? ""} onChange={set("description")} /></Field>
      {error && <p className="text-sm text-bad md:col-span-2">{error}</p>}
      <div className="md:col-span-2"><Button type="submit" variant="primary" loading={busy}>{h.id ? "Save hackathon" : "Create hackathon"}</Button></div>
    </form>
  );
}
