"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { Field, Section } from "@/components/crm/field";
import { TagPicker } from "@/components/crm/tag-picker";
import { supabase } from "@/lib/supabase/client";
import { friendlyError, int, num, str, url } from "@/lib/crm/form";
import { FOLLOW_UP, PROJECT_STATUS, STAGES, TEAM_ROLES } from "@/lib/crm/options";
import type { HackathonLite, Project, Tag } from "@/lib/crm/types";

export const CATEGORIES = [
  "AI", "B2B SaaS", "Climate", "Consumer", "Developer tools", "Education", "Fintech", "Hardware",
  "Health", "Marketplace", "Media", "Mobility", "Social impact", "Other",
];

const TEXT = ["name", "tagline", "description", "problem", "solution", "category", "github_url", "live_url", "demo_url",
  "presentation_url", "traction_notes", "next_steps", "revenue_currency"] as const;
const NUMS = ["users_count", "customers_count", "pilots_count", "meetings_count", "commitments_count", "revenue_amount"] as const;
type Draft = Record<(typeof TEXT)[number] | (typeof NUMS)[number] | "stage" | "status" | "origin_hackathon_id" | "continuing" | "follow_up_status", string>;

function toDraft(p: Project | null, defaultHackathon: string): Draft {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const d = {} as Draft;
  for (const k of TEXT) d[k] = s(p?.[k]);
  for (const k of NUMS) d[k] = s(p?.[k]);
  d.revenue_currency = p?.revenue_currency ?? "SEK";
  d.stage = p?.stage ?? "building";
  d.status = p?.status ?? "active";
  d.origin_hackathon_id = p ? s(p.origin_hackathon_id) : defaultHackathon;
  d.continuing = p?.continuing_after_hackathon === true ? "yes" : p?.continuing_after_hackathon === false ? "no" : "";
  d.follow_up_status = p?.follow_up_status ?? "none";
  return d;
}

type NewMember = { email: string; full_name: string; team_role: string };

export function ProjectForm({
  project, isStaff, hackathons, tags: initialTags, tagIds,
}: {
  project: Project | null;
  isStaff: boolean;
  hackathons: HackathonLite[];
  tags: Tag[];
  tagIds: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const active = hackathons.find((h) => h.status === "active")?.id ?? "";
  const [d, setD] = useState<Draft>(() => toDraft(project, active));
  const [tags, setTags] = useState(initialTags);
  const [sel, setSel] = useState<string[]>(tagIds);
  const [team, setTeam] = useState<NewMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setD((prev) => ({ ...prev, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!d.name.trim()) return setError("Project name is required.");
    const bad = team.find((m) => m.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email.trim()));
    if (bad) return setError(`Teammate email “${bad.email}” looks invalid.`);
    setBusy(true);
    const sb = supabase();
    try {
      const fields: Record<string, unknown> = {
        name: d.name.trim(), tagline: str(d.tagline), description: str(d.description), problem: str(d.problem),
        solution: str(d.solution), category: str(d.category), stage: d.stage, status: d.status,
        origin_hackathon_id: str(d.origin_hackathon_id),
        continuing_after_hackathon: d.continuing === "yes" ? true : d.continuing === "no" ? false : null,
        github_url: url(d.github_url), live_url: url(d.live_url), demo_url: url(d.demo_url), presentation_url: url(d.presentation_url),
        users_count: int(d.users_count), customers_count: int(d.customers_count), pilots_count: int(d.pilots_count),
        meetings_count: int(d.meetings_count), commitments_count: int(d.commitments_count), revenue_amount: num(d.revenue_amount),
        revenue_currency: (str(d.revenue_currency) ?? "SEK").toUpperCase(),
        traction_notes: str(d.traction_notes), next_steps: str(d.next_steps),
      };
      if (isStaff) fields.follow_up_status = d.follow_up_status;

      let id = project?.id;
      if (!id) {
        const { data, error } = await sb.from("projects").insert(fields).select("id").single();
        if (error) throw error;
        id = data.id as string;
      } else {
        const { data, error } = await sb.from("projects").update(fields).eq("id", id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("You can only edit projects you are a member of.");
      }

      const removed = tagIds.filter((t) => !sel.includes(t));
      if (removed.length) {
        const { error } = await sb.from("project_tags").delete().eq("project_id", id).in("tag_id", removed);
        if (error) throw error;
      }
      const added = sel.filter((t) => !tagIds.includes(t));
      if (added.length) {
        const { error } = await sb.from("project_tags").upsert(added.map((tag_id) => ({ project_id: id, tag_id })), { onConflict: "project_id,tag_id", ignoreDuplicates: true });
        if (error) throw error;
      }

      const failed: string[] = [];
      for (const m of team.filter((m) => m.email.trim())) {
        const { error } = await sb.rpc("add_project_member", {
          p_project_id: id, p_email: m.email.trim(), p_team_role: m.team_role, p_full_name: str(m.full_name),
        });
        if (error) failed.push(`${m.email}: ${friendlyError(error)}`);
      }
      if (failed.length) toast.error("Some teammates could not be added", failed.join("\n"));
      toast.success(project ? "Project saved" : "Project submitted");
      setTeam([]);
      if (!project) router.replace(`/projects/${id}`);
      router.refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Section n={1} title="Project basics">
        <Field label="Project name *"><Input value={d.name} onChange={set("name")} maxLength={120} required /></Field>
        <Field label="Category">
          <Input value={d.category} onChange={set("category")} list="project-categories" maxLength={60} placeholder="e.g. Health" />
          <datalist id="project-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="One-line pitch" className="md:col-span-2"><Input value={d.tagline} onChange={set("tagline")} maxLength={200} placeholder="Uber for …" /></Field>
        <Field label="Hackathon">
          <Select value={d.origin_hackathon_id} onChange={set("origin_hackathon_id")}>
            <option value="">— none —</option>
            {hackathons.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </Select>
        </Field>
        <Field label="Stage">
          <Select value={d.stage} onChange={set("stage")}>{STAGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </Field>
      </Section>

      <Section n={2} title="Problem & solution">
        <Field label="Problem" className="md:col-span-2"><Textarea rows={2} value={d.problem} onChange={set("problem")} maxLength={3000} /></Field>
        <Field label="Solution" className="md:col-span-2"><Textarea rows={2} value={d.solution} onChange={set("solution")} maxLength={3000} /></Field>
        <Field label="Description" hint="optional, longer" className="md:col-span-2"><Textarea rows={3} value={d.description} onChange={set("description")} maxLength={5000} /></Field>
      </Section>

      {!project && (
        <Section n={3} title="Team" desc="You are added automatically. Add teammates by email — they see the project as soon as they sign in with that email.">
          <div className="space-y-2 md:col-span-2">
            {team.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_9rem_auto] gap-2">
                <Input placeholder="teammate@email.com" type="email" value={m.email} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                <Input placeholder="Name (optional)" value={m.full_name} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, full_name: e.target.value } : x)))} />
                <Select value={m.team_role} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, team_role: e.target.value } : x)))}>
                  {TEAM_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
                <button type="button" onClick={() => setTeam(team.filter((_, j) => j !== i))} className="px-2 text-dim hover:text-bad" aria-label="Remove"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button type="button" size="sm" onClick={() => setTeam([...team, { email: "", full_name: "", team_role: "developer" }])}>
              <Plus className="size-4" /> Add teammate
            </Button>
          </div>
        </Section>
      )}

      <Section n={4} title="Tech">
        <Field label="Tech stack" className="md:col-span-2">
          <TagPicker type="technology" tags={tags} selected={sel} onChange={setSel} onCreated={(t) => setTags((p) => [...p, t])} placeholder="e.g. Next.js, Supabase, OpenAI" />
        </Field>
      </Section>

      <Section n={5} title="Links">
        <Field label="GitHub"><Input value={d.github_url} onChange={set("github_url")} placeholder="github.com/…" /></Field>
        <Field label="Live URL"><Input value={d.live_url} onChange={set("live_url")} /></Field>
        <Field label="Demo video"><Input value={d.demo_url} onChange={set("demo_url")} /></Field>
        <Field label="Presentation / slides"><Input value={d.presentation_url} onChange={set("presentation_url")} /></Field>
      </Section>

      <Section n={6} title="Traction" desc="Whatever you have — all optional.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:col-span-2">
          {([["users_count", "Users"], ["customers_count", "Paying customers"], ["pilots_count", "Pilots"], ["meetings_count", "Meetings booked"], ["commitments_count", "Commitments / LOIs"]] as const).map(([k, l]) => (
            <Field key={k} label={l}><Input type="number" min={0} value={d[k]} onChange={set(k)} /></Field>
          ))}
          <Field label="Revenue">
            <div className="flex gap-1">
              <Input type="number" min={0} step="0.01" value={d.revenue_amount} onChange={set("revenue_amount")} />
              <Input className="!w-20" value={d.revenue_currency} onChange={set("revenue_currency")} maxLength={3} />
            </div>
          </Field>
        </div>
        <Field label="Traction notes" className="md:col-span-2"><Textarea rows={2} value={d.traction_notes} onChange={set("traction_notes")} maxLength={4000} placeholder="Who did you talk to, what did they say, what did you sell?" /></Field>
      </Section>

      <Section n={7} title="What happens next">
        <Field label="Continuing after the hackathon?">
          <Select value={d.continuing} onChange={set("continuing")}>
            <option value="">Not sure yet</option><option value="yes">Yes</option><option value="no">No</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={d.status} onChange={set("status")}>{PROJECT_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        </Field>
        <Field label="Next steps" className="md:col-span-2"><Textarea rows={2} value={d.next_steps} onChange={set("next_steps")} maxLength={4000} /></Field>
        {isStaff && (
          <Field label="21Moons follow-up (internal)">
            <Select value={d.follow_up_status} onChange={set("follow_up_status")}>{FOLLOW_UP.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </Field>
        )}
      </Section>

      {error && <p className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-void/90 px-4 py-3 backdrop-blur">
        {project && <span className="mr-auto text-xs text-dim">Last updated {new Date(project.updated_at).toLocaleString()}</span>}
        <Button type="submit" variant="primary" loading={busy}>{project ? "Save project" : "Submit project"}</Button>
      </div>
    </form>
  );
}
