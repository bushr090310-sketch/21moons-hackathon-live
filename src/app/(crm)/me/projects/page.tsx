import Link from "next/link";
import { requireViewer } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/crm/page-header";
import { labelOf, STAGES } from "@/lib/crm/options";

export const metadata = { title: "My projects" };

export default async function MyProjects() {
  const viewer = await requireViewer();
  const sb = await createClient();
  // Membership-scoped explicitly, so staff see only their own projects here too.
  const { data: memberships } = viewer.personId
    ? await sb.from("project_members").select("team_role, projects(id, name, tagline, stage, hackathons(name))").eq("person_id", viewer.personId)
    : { data: [] };
  type Row = { team_role: string; projects: { id: string; name: string; tagline: string | null; stage: string; hackathons: { name: string } | null } | null };
  const rows = ((memberships ?? []) as unknown as Row[]).filter((r) => r.projects);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="My projects"
        subtitle="Submit what you built and add your teammates by email. Every team member can edit the project."
        actions={<Link href="/projects/new" className="rounded-lg bg-violet-deep px-4 py-2 text-sm font-medium text-white hover:brightness-110">Submit a project</Link>}
      />
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-8 text-center text-mist">
          No projects yet. If a teammate already submitted your project with your email, it shows up here automatically.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.projects!.id}>
              <Link href={`/projects/${r.projects!.id}`} className="block rounded-xl border border-line bg-ink/70 p-4 hover:border-line-strong">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-silver">{r.projects!.name}</span>
                  <span className="text-xs text-dim">{labelOf(STAGES, r.projects!.stage)} · {r.projects!.hackathons?.name ?? "no hackathon"}</span>
                </div>
                {r.projects!.tagline && <p className="mt-1 text-sm text-mist">{r.projects!.tagline}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
