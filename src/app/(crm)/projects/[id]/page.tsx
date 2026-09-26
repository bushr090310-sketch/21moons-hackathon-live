import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadLookups } from "@/lib/crm/queries";
import { PageHeader } from "@/components/crm/page-header";
import { ProjectForm } from "@/components/crm/project-form";
import { TeamPanel } from "@/components/crm/team-panel";
import { DeleteProject } from "./delete-project";
import type { Project, TeamMember } from "@/lib/crm/types";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const viewer = await requireViewer();
  const sb = await createClient();
  // RLS: members, the creator, and staff can read the project.
  const [{ data: project }, { data: team }, { data: tagRows }, lookups] = await Promise.all([
    sb.from("projects").select("*").eq("id", id).maybeSingle(),
    sb.rpc("project_team", { p_project_id: id }),
    sb.from("project_tags").select("tag_id").eq("project_id", id),
    loadLookups(sb),
  ]);
  if (!project) notFound();
  const p = project as Project;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={p.name}
        subtitle={[p.tagline, lookups.hackathons.find((h) => h.id === p.origin_hackathon_id)?.name].filter(Boolean).join(" · ")}
      />
      <TeamPanel projectId={p.id} team={(team ?? []) as TeamMember[]} isStaff={viewer.isStaff} myPersonId={viewer.personId} />
      <ProjectForm
        project={p}
        isStaff={viewer.isStaff}
        hackathons={lookups.hackathons}
        tags={lookups.tags}
        tagIds={(tagRows ?? []).map((r: { tag_id: string }) => r.tag_id)}
      />
      {viewer.isAdmin && <DeleteProject id={p.id} name={p.name} />}
    </div>
  );
}
