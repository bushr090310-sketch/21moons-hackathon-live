import Link from "next/link";
import { requireStaff } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPeople, loadProjects } from "@/lib/crm/directory";
import { startOfTodayStockholm } from "@/lib/crm/search";
import { AVAILABILITY, STAGES, labelOf } from "@/lib/crm/options";
import { PageHeader, Card } from "@/components/crm/page-header";
import { cx } from "@/components/ui";

export const metadata = { title: "Dashboard" };

type Overview = { hackathon_id: string; has_account: boolean; profile_complete: boolean; has_project: boolean; status: string };

export default async function Dashboard() {
  await requireStaff();
  const sb = await createClient();
  const [people, projects, { data: hackathons }, { count: pendingTags }] = await Promise.all([
    loadPeople(sb),
    loadProjects(sb),
    sb.from("hackathons").select("id, name, status, starts_on").order("starts_on", { ascending: false, nullsFirst: false }),
    sb.from("tags").select("id", { count: "exact", head: true }).eq("approved", false),
  ]);
  const current = (hackathons ?? []).find((h) => h.status === "active") ?? null;
  const { data: ov } = current
    ? await sb.from("hackathon_participant_overview").select("hackathon_id, has_account, profile_complete, has_project, status").eq("hackathon_id", current.id)
    : { data: [] };
  const overview = (ov ?? []) as Overview[];

  const today = startOfTodayStockholm().getTime();
  const isToday = (iso: string) => new Date(iso).getTime() >= today;
  const liveProjects = projects.filter((p) => !p.archived_at);
  const currentProjects = current ? liveProjects.filter((p) => p.origin_hackathon_id === current.id) : [];

  const tally = (values: (string | null | undefined)[]) => {
    const m = new Map<string, number>();
    values.forEach((v) => m.set(v ?? "—", (m.get(v ?? "—") ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const hName = new Map((hackathons ?? []).map((h) => [h.id, h.name]));

  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" subtitle={current ? `Current hackathon: ${current.name}` : "No active hackathon — set one to “active” on the Hackathons page."} />

      {current && (
        <Card title="Current hackathon" actions={<Link href={`/hackathons/${current.id}`} className="text-xs text-violet hover:underline">Open →</Link>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Participants" value={overview.length} href={`/hackathons/${current.id}`} />
            <Stat label="Signed in" value={overview.filter((o) => o.has_account).length} />
            <Stat label="Missing profile" value={overview.filter((o) => !o.profile_complete).length} warn href={`/hackathons/${current.id}?show=incomplete`} />
            <Stat label="Missing project" value={overview.filter((o) => !o.has_project && o.status !== "withdrawn").length} warn href={`/hackathons/${current.id}?show=no_project`} />
            <Stat label="Projects" value={currentProjects.length} href={`/projects?hackathon=${current.id}`} />
            <Stat label="Teams" value={currentProjects.filter((p) => p.project_members.length > 0).length} />
            <Stat label="Projects w/o team" value={currentProjects.filter((p) => p.project_members.length === 0).length} warn />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="People" value={people.length} href="/people" />
        <Stat label="People added today" value={people.filter((p) => isToday(p.created_at)).length} />
        <Stat label="Projects" value={liveProjects.length} href="/projects" />
        <Stat label="Projects submitted today" value={liveProjects.filter((p) => isToday(p.created_at)).length} />
      </div>
      {!!pendingTags && (
        <p className="text-sm text-warn"><Link href="/tags" className="underline">{pendingTags} suggested skills/tools/tech</Link> are waiting for approval.</p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown title="People by role" rows={tally(people.map((p) => p.primary_role?.label))} />
        <Breakdown title="People by availability" rows={tally(people.map((p) => (p.availability_status ? labelOf(AVAILABILITY, p.availability_status) : null)))} />
        <Breakdown title="People by technology" rows={tally(people.flatMap((p) => p.person_tags.filter((t) => t.tags?.type === "technology").map((t) => t.tags!.name)))} />
        <Breakdown title="People by hackathon" rows={tally(people.flatMap((p) => p.hackathon_participants.map((h) => hName.get(h.hackathon_id))))} />
        <Breakdown title="Projects by stage" rows={tally(liveProjects.map((p) => labelOf(STAGES, p.stage)))} />
        <Breakdown title="Projects by category" rows={tally(liveProjects.map((p) => p.category))} />
      </div>
    </div>
  );
}

function Stat({ label, value, warn, href }: { label: string; value: number; warn?: boolean; href?: string }) {
  const body = (
    <div className={cx("rounded-xl border border-line bg-ink/70 px-3 py-2.5", href && "hover:border-line-strong")}>
      <div className={cx("text-2xl font-semibold tabular-nums", warn && value > 0 ? "text-warn" : "text-silver")}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-dim">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-dim">No data yet.</p> : (
        <ul className="space-y-1.5">
          {rows.slice(0, 12).map(([k, v]) => (
            <li key={k} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 text-sm">
              <span className="truncate text-mist" title={k}>{k}</span>
              <span className="h-2 rounded-full bg-white/[0.05]"><span className="block h-2 rounded-full bg-violet/70" style={{ width: `${(v / max) * 100}%` }} /></span>
              <span className="text-right tabular-nums text-silver">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
