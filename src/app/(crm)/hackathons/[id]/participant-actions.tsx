"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { friendlyError, str } from "@/lib/crm/form";
import { PARTICIPANT_STATUS } from "@/lib/crm/options";

export function ParticipantActions({ hackathonId, personId, status }: { hackathonId: string; personId: string; status: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  async function change(next: string) {
    const { error } = await supabase().from("hackathon_participants").update({ status: next }).eq("hackathon_id", hackathonId).eq("person_id", personId);
    if (error) setErr(friendlyError(error));
    router.refresh();
  }
  return (
    <>
      <select value={status} onChange={(e) => change(e.target.value)} className="h-8 rounded-md border border-line-strong bg-ink px-2 text-xs">
        {PARTICIPANT_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {err && <div className="text-xs text-bad">{err}</div>}
    </>
  );
}

// Admin: add one participant. Reuses import_participants so dedupe-by-email is identical to CSV import.
export function AddParticipant({ hackathonId }: { hackathonId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase().rpc("import_participants", { p_hackathon_id: hackathonId, p_rows: [{ email, full_name: str(name) }] });
    if (error) return setMsg(friendlyError(error));
    const r = (data as { out_result: string; out_message: string | null }[])[0];
    setMsg(r.out_result === "error" ? r.out_message : r.out_result === "created" ? "Added new person." : "Existing person added.");
    setEmail("");
    setName("");
    router.refresh();
  }
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-violet hover:underline">+ Add participant</button>;
  return (
    <form onSubmit={add} className="flex flex-wrap items-center gap-1">
      <Input type="email" required placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} className="!h-8 !w-44 text-sm" />
      <Input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} className="!h-8 !w-32 text-sm" />
      <Button size="sm" type="submit">Add</Button>
      {msg && <span className="text-xs text-mist">{msg}</span>}
    </form>
  );
}

export function RegisterMembers({ hackathonId, personIds }: { hackathonId: string; personIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    const { error } = await supabase().from("hackathon_participants").upsert(
      personIds.map((person_id) => ({ hackathon_id: hackathonId, person_id, source: "admin" })),
      { onConflict: "hackathon_id,person_id", ignoreDuplicates: true },
    );
    setBusy(false);
    if (error) return setErr(friendlyError(error));
    router.refresh();
  }
  return (
    <>
      <Button size="sm" loading={busy} onClick={run}>Register them as participants</Button>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </>
  );
}
