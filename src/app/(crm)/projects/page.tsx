import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadLookups } from "@/lib/crm/queries";
import { loadProjects, projectHaystack } from "@/lib/crm/directory";
import { matchesQuery } from "@/lib/crm/search";
import { FOLLOW_UP, PROJECT_STATUS, STAGES, labelOf } from "@/lib/crm/options";
import { FilterBar } from "@/components/crm/filters";
import { PageHeader } from "@/components/crm/page-header";
import { Chips } from "@/components/crm/chips";
import { Badge } from "@/components/ui";

export const metadata = { title: "Projects" };

type SP = Record<string, string | undefined>;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  if (!viewer.isStaff) redirect("/me/projects");
  const sp = await searchParams;
  const sb = await createClient();
  const [projects, { tags, hackathons }] = await Promise.all([loadProjects(sb), loadLookups(sb)]);
  const categories = [...new Set(projects.map((p) => p.category).filter((c): c is string => !!c))].sort();

  const rows = projects.filter((p) => {
    if (!sp.archived && p.archived_at) return false;
    if (sp.hackathon && p.origin_hackathon_id !== sp.hackathon) return false;
    if (sp.stage && p.stage !== sp.stage) return false;
    if (sp.status && p.status !== sp.status) return false;
    if (sp.category && p.category !== sp.category) return false;
    if (sp.follow_up && p.follow_up_status !== sp.follow_up) return false;
    if (sp.continuing === "yes" && p.continuing_after_hackathon !== true) return false;
    if (sp.technology && !p.project_tags.some((t) => t.tags?.id === sp.technology)) return false;
    if (sp.member && !p.project_members.some((m) => matchesQuery([m.people?.full_name, m.people?.email], sp.member))) return false;
    return matchesQuery(projectHaystack(p), sp.q);
  });

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle={`${rows.length} of ${projects.length} projects`}
        actions={
          <>
            <a href="/api/crm/export/projects" className="rounded-lg border border-line-strong px-3 py-2 text-sm text-mist hover:text-silver">Export CSV</a>
            <Link href="/projects/new" className="rounded-lg bg-violet-deep px-3 py-2 text-sm font-medium text-white hover:brightness-110">Add project</Link>
          </>
        }
      />
      <FilterBar resetHref="/projects">
        <input name="q" defaultValue={sp.q} placeholder="Search: healthcare AI react…" className="min-w-[16rem] flex-1" />
        <select name="hackathon" defaultValue={sp.hackathon ?? ""}>
          <option value="">Any hackathon</option>
          {hackathons.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <select name="stage" defaultValue={sp.stage ?? ""}>
          <option value="">Any stage</option>
          {STAGES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""}>
          <option value="">Any status</option>
          {PROJECT_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select name="category" defaultValue={sp.category ?? ""}>
          <option value="">Any category</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="technology" defaultValue={sp.technology ?? ""}>
          <option value="">Any tech</option>
          {tags.filter((t) => t.type === "technology").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select name="follow_up" defaultValue={sp.follow_up ?? ""}>
          <option value="">Any follow-up</option>
          {FOLLOW_UP.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select name="continuing" defaultValue={sp.continuing ?? ""}>
          <option value="">Continuing: any</option>
          <option value="yes">Continuing after hackathon</option>
        </select>
        <select name="archived" defaultValue={sp.archived ?? ""}>
          <option value="">Hide archived</option>
          <option value="1">Include archived</option>
        </select>
        <input name="member" defaultValue={sp.member} placeholder="Team member" className="w-36" />
      </FilterBar>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="flex flex-col gap-2 rounded-xl border border-line bg-ink/70 p-4 hover:border-line-strong">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-silver">{p.name}</div>
                <div className="text-xs text-dim">{p.hackathon?.name ?? "No hackathon"}{p.category ? ` · ${p.category}` : ""}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone="violet">{labelOf(STAGES, p.stage)}</Badge>
                {p.status !== "active" && <Badge tone="warn">{labelOf(PROJECT_STATUS, p.status)}</Badge>}
              </div>
            </div>
            {(p.tagline || p.description) && <p className="line-clamp-2 text-sm text-mist">{p.tagline ?? p.description}</p>}
            <Chips items={p.project_tags.map((t) => t.tags?.name).filter((n): n is string => !!n)} />
            <div className="text-xs text-mist">
              {p.project_members.length ? p.project_members.map((m) => m.people?.full_name ?? m.people?.email).join(", ") : <span className="text-bad">No team members</span>}
            </div>
            <div className="mt-auto flex flex-wrap gap-3 text-xs text-dim">
              {p.github_url && <span>GitHub ✓</span>}
              {p.live_url && <span>Live ✓</span>}
              {p.users_count != null && <span>{p.users_count} users</span>}
              {p.revenue_amount != null && <span>{p.revenue_amount} {p.revenue_currency}</span>}
              {p.follow_up_status !== "none" && <span>Follow-up: {labelOf(FOLLOW_UP, p.follow_up_status)}</span>}
            </div>
          </Link>
        ))}
        {rows.length === 0 && <p className="col-span-full rounded-xl border border-dashed border-line-strong p-10 text-center text-mist">No projects match these filters.</p>}
      </div>
    </>
  );
}
