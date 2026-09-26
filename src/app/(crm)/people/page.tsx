import Link from "next/link";
import { requireStaff } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadLookups } from "@/lib/crm/queries";
import { loadPeople, personHaystack, type PersonRow } from "@/lib/crm/directory";
import { matchesQuery } from "@/lib/crm/search";
import { AVAILABILITY, OPEN_TO, labelOf } from "@/lib/crm/options";
import { FilterBar } from "@/components/crm/filters";
import { PageHeader } from "@/components/crm/page-header";
import { Chips } from "@/components/crm/chips";

export const metadata = { title: "People" };

type SP = Record<string, string | undefined>;

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff();
  const sp = await searchParams;
  const sb = await createClient();
  const [people, { roles, tags, hackathons }] = await Promise.all([loadPeople(sb), loadLookups(sb)]);

  const tagSet = (p: PersonRow) => new Set(p.person_tags.map((t) => t.tags?.id));
  const rows = people.filter((p) => {
    if (sp.role && String(p.primary_role_id) !== sp.role && String(p.secondary_role_id) !== sp.role) return false;
    if (sp.availability && p.availability_status !== sp.availability) return false;
    if (sp.open_to && !p.open_to.includes(sp.open_to)) return false;
    for (const k of ["skill", "tool", "technology"] as const) if (sp[k] && !tagSet(p).has(sp[k])) return false;
    if (sp.hackathon && !p.hackathon_participants.some((h) => h.hackathon_id === sp.hackathon)) return false;
    if (sp.project === "yes" && p.project_members.length === 0) return false;
    if (sp.project === "no" && p.project_members.length > 0) return false;
    if (sp.account === "yes" && !p.auth_user_id) return false;
    if (sp.account === "no" && p.auth_user_id) return false;
    if (sp.location && !matchesQuery([p.location], sp.location)) return false;
    return matchesQuery(personHaystack(p), sp.q);
  });

  const tagOptions = (type: string) => tags.filter((t) => t.type === type);
  const hName = new Map(hackathons.map((h) => [h.id, h.name]));

  return (
    <>
      <PageHeader
        title="People"
        subtitle={`${rows.length} of ${people.length} people`}
        actions={
          <>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page */}
            <a href="/api/crm/export/people" className="rounded-lg border border-line-strong px-3 py-2 text-sm text-mist hover:text-silver">Export CSV</a>
            <Link href="/people/new" className="rounded-lg bg-violet-deep px-3 py-2 text-sm font-medium text-white hover:brightness-110">Add person</Link>
          </>
        }
      />
      <FilterBar resetHref="/people">
        <input name="q" defaultValue={sp.q} placeholder="Search: python designer malmö…" className="min-w-[16rem] flex-1" />
        <select name="role" defaultValue={sp.role ?? ""}>
          <option value="">Any role</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        {(["skill", "tool", "technology"] as const).map((k) => (
          <select key={k} name={k} defaultValue={sp[k] ?? ""}>
            <option value="">Any {k === "technology" ? "tech" : k}</option>
            {tagOptions(k).map((t) => <option key={t.id} value={t.id}>{t.name}{t.approved ? "" : " (pending)"}</option>)}
          </select>
        ))}
        <select name="availability" defaultValue={sp.availability ?? ""}>
          <option value="">Any availability</option>
          {AVAILABILITY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select name="open_to" defaultValue={sp.open_to ?? ""}>
          <option value="">Open to anything</option>
          {OPEN_TO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select name="hackathon" defaultValue={sp.hackathon ?? ""}>
          <option value="">Any hackathon</option>
          {hackathons.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <select name="project" defaultValue={sp.project ?? ""}>
          <option value="">Project: any</option>
          <option value="yes">In a project</option>
          <option value="no">No project</option>
        </select>
        <select name="account" defaultValue={sp.account ?? ""}>
          <option value="">Account: any</option>
          <option value="yes">Has signed in</option>
          <option value="no">Never signed in</option>
        </select>
        <input name="location" defaultValue={sp.location} placeholder="Location" className="w-32" />
      </FilterBar>

      <div className="overflow-x-auto rounded-xl border border-line bg-ink/70">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-dim">
            <tr>
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Skills & tools</th>
              <th className="px-3 py-2">Tech</th><th className="px-3 py-2">Availability</th><th className="px-3 py-2">Projects</th>
              <th className="px-3 py-2">Hackathons</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-line align-top hover:bg-white/[0.02]">
                <td className="px-3 py-2">
                  <Link href={`/people/${p.id}`} className="font-medium text-silver hover:underline">{p.full_name ?? p.email}</Link>
                  <div className="text-xs text-dim">{p.email}{!p.auth_user_id && " · no login yet"}</div>
                  {p.headline && <div className="mt-0.5 max-w-xs truncate text-xs text-mist">{p.headline}</div>}
                </td>
                <td className="px-3 py-2 text-mist">
                  {p.primary_role?.label ?? "—"}
                  {p.secondary_role && <div className="text-xs text-dim">{p.secondary_role.label}</div>}
                </td>
                <td className="px-3 py-2"><Chips items={p.person_tags.filter((t) => t.tags && t.tags.type !== "technology").map((t) => t.tags!.name)} /></td>
                <td className="px-3 py-2"><Chips items={p.person_tags.filter((t) => t.tags?.type === "technology").map((t) => t.tags!.name)} /></td>
                <td className="px-3 py-2 text-mist">
                  {labelOf(AVAILABILITY, p.availability_status)}
                  {p.location && <div className="text-xs text-dim">{p.location}</div>}
                </td>
                <td className="px-3 py-2 text-xs">
                  {p.project_members.map((m) => m.projects && (
                    <Link key={m.projects.id} href={`/projects/${m.projects.id}`} className="block text-mist hover:text-silver">{m.projects.name}</Link>
                  ))}
                </td>
                <td className="px-3 py-2 text-xs text-dim">{p.hackathon_participants.map((h) => hName.get(h.hackathon_id)).filter(Boolean).join(", ")}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-mist">No people match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

