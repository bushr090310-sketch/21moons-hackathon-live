import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/crm/page-header";
import { HackathonForm } from "@/components/crm/hackathon-form";
import { Badge, cx } from "@/components/ui";
import { labelOf, STAGES } from "@/lib/crm/options";
import { AddParticipant, ParticipantActions, RegisterMembers } from "./participant-actions";

export const metadata = { title: "Hackathon" };

type Overview = { person_id: string; full_name: string | null; email: string; status: string; has_account: boolean; profile_complete: boolean; has_project: boolean };
type Proj = { id: string; name: string; tagline: string | null; stage: string; category: string | null; github_url: string | null; live_url: string | null; project_members: { person_id: string; team_role: string; people: { full_name: string | null; email: string } | null }[] };

const TABS = [
  { key: "", label: "All" },
  { key: "no_account", label: "Never signed in" },
  { key: "incomplete", label: "Missing profile" },
  { key: "no_project", label: "Missing project" },
  { key: "checked_in", label: "Checked in" },
];

export default async function HackathonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ show?: string }> }) {
  const { id } = await params;
  const { show = "" } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const viewer = await requireStaff();
  const sb = await createClient();
  const [{ data: h }, { data: ov }, { data: pr }] = await Promise.all([
    sb.from("hackathons").select("*").eq("id", id).maybeSingle(),
    sb.from("hackathon_participant_overview").select("*").eq("hackathon_id", id).order("full_name"),
    sb.from("projects").select("id, name, tagline, stage, category, github_url, live_url, project_members(person_id, team_role, people(full_name, email))").eq("origin_hackathon_id", id).is("archived_at", null).order("name"),
  ]);
  if (!h) notFound();
  const participants = (ov ?? []) as Overview[];
  const projects = (pr ?? []) as unknown as Proj[];

  const registered = new Set(participants.map((p) => p.person_id));
  const unregisteredMembers = [...new Map(
    projects.flatMap((p) => p.project_members).filter((m) => !registered.has(m.person_id)).map((m) => [m.person_id, m]),
  ).values()];
  const teams = projects.filter((p) => p.project_members.length > 0);

  const stats = [
    { label: "Participants", value: participants.length },
    { label: "Checked in", value: participants.filter((p) => p.status === "checked_in").length },
    { label: "Signed in", value: participants.filter((p) => p.has_account).length },
    { label: "Profile complete", value: participants.filter((p) => p.profile_complete).length },
    { label: "In a project", value: participants.filter((p) => p.has_project).length },
    { label: "Projects", value: projects.length },
    { label: "Teams (≥1 member)", value: teams.length },
    { label: "Missing project", value: participants.filter((p) => !p.has_project && p.status !== "withdrawn").length, warn: true },
  ];

  const shown = participants.filter((p) =>
    show === "no_account" ? !p.has_account : show === "incomplete" ? !p.profile_complete : show === "no_project" ? !p.has_project : show === "checked_in" ? p.status === "checked_in" : true,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={h.name}
        subtitle={[h.starts_on, h.location, h.status].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link href={`/people?hackathon=${id}`} className="rounded-lg border border-line-strong px-3 py-2 text-sm text-mist hover:text-silver">People view</Link>
            <Link href={`/projects?hackathon=${id}`} className="rounded-lg border border-line-strong px-3 py-2 text-sm text-mist hover:text-silver">Projects view</Link>
            {viewer.isAdmin && <Link href="/import" className="rounded-lg bg-violet-deep px-3 py-2 text-sm font-medium text-white">Import CSV</Link>}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-ink/70 px-3 py-2.5">
            <div className={cx("text-2xl font-semibold tabular-nums", s.warn && s.value > 0 ? "text-warn" : "text-silver")}>{s.value}</div>
            <div className="text-[11px] uppercase tracking-wider text-dim">{s.label}</div>
          </div>
        ))}
      </div>

      {unregisteredMembers.length > 0 && (
        <Card title={`Project members not registered for this hackathon (${unregisteredMembers.length})`}>
          <p className="mb-2 text-sm text-mist">{unregisteredMembers.map((m) => m.people?.full_name ?? m.people?.email).join(", ")}</p>
          <RegisterMembers hackathonId={id} personIds={unregisteredMembers.map((m) => m.person_id)} />
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card title={`Participants (${shown.length})`} actions={viewer.isAdmin ? <AddParticipant hackathonId={id} /> : undefined}>
          <div className="mb-3 flex flex-wrap gap-1">
            {TABS.map((t) => (
              <Link key={t.key} href={`/hackathons/${id}${t.key ? `?show=${t.key}` : ""}`} className={cx("rounded-md px-2.5 py-1 text-xs", show === t.key ? "bg-white/[0.08] text-silver" : "text-mist hover:text-silver")}>{t.label}</Link>
            ))}
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-ink text-xs uppercase tracking-wider text-dim">
                <tr><th className="py-2 pr-2">Name</th><th className="py-2 pr-2">Login</th><th className="py-2 pr-2">Profile</th><th className="py-2 pr-2">Project</th><th className="py-2">Status</th></tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.person_id} className="border-t border-line">
                    <td className="py-1.5 pr-2">
                      <Link href={`/people/${p.person_id}`} className="text-silver hover:underline">{p.full_name ?? p.email}</Link>
                      <div className="text-xs text-dim">{p.email}</div>
                    </td>
                    <td className="py-1.5 pr-2">{p.has_account ? <Badge tone="ok">yes</Badge> : <Badge>no</Badge>}</td>
                    <td className="py-1.5 pr-2">{p.profile_complete ? <Badge tone="ok">complete</Badge> : <Badge tone="warn">missing</Badge>}</td>
                    <td className="py-1.5 pr-2">{p.has_project ? <Badge tone="ok">yes</Badge> : <Badge tone="warn">none</Badge>}</td>
                    <td className="py-1.5"><ParticipantActions hackathonId={id} personId={p.person_id} status={p.status} /></td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-mist">Nobody here.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={`Projects & teams (${projects.length})`}>
          <ul className="space-y-3">
            {projects.map((p) => (
              <li key={p.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/projects/${p.id}`} className="font-medium text-silver hover:underline">{p.name}</Link>
                  <Badge tone="violet">{labelOf(STAGES, p.stage)}</Badge>
                </div>
                {p.tagline && <p className="mt-0.5 text-xs text-mist">{p.tagline}</p>}
                <p className="mt-1 text-xs text-dim">
                  {p.project_members.length ? p.project_members.map((m) => `${m.people?.full_name ?? m.people?.email} (${m.team_role})`).join(", ") : <span className="text-bad">no members</span>}
                </p>
                <p className="mt-1 flex gap-3 text-xs">
                  {p.github_url && <a href={p.github_url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">GitHub</a>}
                  {p.live_url && <a href={p.live_url} target="_blank" rel="noreferrer" className="text-cyan hover:underline">Live</a>}
                </p>
              </li>
            ))}
            {projects.length === 0 && <li className="text-sm text-mist">No projects submitted yet.</li>}
          </ul>
        </Card>
      </div>

      {viewer.isAdmin && (
        <Card title="Edit hackathon">
          <HackathonForm hackathon={h} />
        </Card>
      )}
    </div>
  );
}
