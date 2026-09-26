"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Badge, Button, Input, Select } from "@/components/ui";
import { Card } from "@/components/crm/page-header";
import { supabase } from "@/lib/supabase/client";
import { friendlyError, str } from "@/lib/crm/form";
import { TEAM_ROLES } from "@/lib/crm/options";
import type { TeamMember } from "@/lib/crm/types";

// Team list comes from rpc('project_team') (names + roles only, no contact data).
// Adding goes through rpc('add_project_member'), which creates a stub person for new
// emails; the stub links to the real account when that person signs in.
export function TeamPanel({ projectId, team, isStaff, myPersonId }: { projectId: string; team: TeamMember[]; isStaff: boolean; myPersonId: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().rpc("add_project_member", { p_project_id: projectId, p_email: email.trim(), p_team_role: role, p_full_name: str(name) });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setEmail("");
    setName("");
    router.refresh();
  }

  async function changeRole(personId: string, team_role: string) {
    const { error } = await supabase().from("project_members").update({ team_role }).eq("project_id", projectId).eq("person_id", personId);
    if (error) setError(friendlyError(error));
    router.refresh();
  }

  async function remove(m: TeamMember) {
    const self = m.person_id === myPersonId;
    if (!confirm(self ? "Leave this project? You will lose access to it." : `Remove ${m.full_name ?? "this member"} from the team?`)) return;
    const { error } = await supabase().from("project_members").delete().eq("project_id", projectId).eq("person_id", m.person_id);
    if (error) return setError(friendlyError(error));
    if (self && !isStaff) window.location.href = "/me/projects";
    else router.refresh();
  }

  return (
    <Card title={`Team (${team.length})`}>
      <ul className="mb-4 divide-y divide-line">
        {team.map((m) => (
          <li key={m.person_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            {isStaff ? (
              <Link href={`/people/${m.person_id}`} className="font-medium text-silver hover:underline">{m.full_name ?? "(invited, no name yet)"}</Link>
            ) : (
              <span className="font-medium text-silver">{m.full_name ?? "(invited, no name yet)"}</span>
            )}
            {m.is_lead && <Badge tone="violet">lead</Badge>}
            {m.primary_role && <span className="text-xs text-dim">{m.primary_role}</span>}
            <Select value={m.team_role} onChange={(e) => changeRole(m.person_id, e.target.value)} className="!ml-auto !h-8 !w-32 text-sm">
              {TEAM_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
            <button type="button" onClick={() => remove(m)} className="text-dim hover:text-bad" aria-label="Remove member"><Trash2 className="size-4" /></button>
          </li>
        ))}
        {team.length === 0 && <li className="py-2 text-sm text-dim">No members yet.</li>}
      </ul>
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
        <Input type="email" required placeholder="teammate@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="!h-9" />
        <Input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className="!h-9" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="!h-9">
          {TEAM_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Button type="submit" size="sm" loading={busy} className="!h-9">Add</Button>
      </form>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </Card>
  );
}
