import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadLookups, loadProfile } from "@/lib/crm/queries";
import { PageHeader, Card } from "@/components/crm/page-header";
import { ProfileForm } from "@/components/crm/profile-form";
import { Documents } from "@/components/crm/documents";
import { Badge } from "@/components/ui";
import { labelOf, PARTICIPANT_STATUS, TEAM_ROLES } from "@/lib/crm/options";
import { DeletePerson } from "./delete-person";

export const metadata = { title: "Person" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const viewer = await requireStaff();
  const sb = await createClient();
  const [lookups, profile, { data: memberships }, { data: parts }] = await Promise.all([
    loadLookups(sb),
    loadProfile(sb, id),
    sb.from("project_members").select("team_role, is_lead, projects(id, name, stage)").eq("person_id", id),
    sb.from("hackathon_participants").select("status, source, created_at, hackathons(id, name)").eq("person_id", id),
  ]);
  if (!profile) notFound();
  const p = profile.person;
  type M = { team_role: string; is_lead: boolean; projects: { id: string; name: string; stage: string } | null };
  type H = { status: string; source: string; hackathons: { id: string; name: string } | null };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={p.full_name ?? p.email}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{p.email}</span>
            {p.phone && <span>· {p.phone}</span>}
            {p.auth_user_id ? <Badge tone="ok">has login</Badge> : <Badge>no login yet</Badge>}
            <Badge>source: {p.source}</Badge>
            {p.privacy_consent_at ? <Badge tone="ok">consent {new Date(p.privacy_consent_at).toLocaleDateString()}</Badge> : <Badge tone="warn">no consent recorded</Badge>}
          </span>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Projects">
          {((memberships ?? []) as unknown as M[]).filter((m) => m.projects).map((m) => (
            <Link key={m.projects!.id} href={`/projects/${m.projects!.id}`} className="block py-1 text-sm text-silver hover:underline">
              {m.projects!.name} <span className="text-dim">· {labelOf(TEAM_ROLES, m.team_role)}{m.is_lead ? " · lead" : ""}</span>
            </Link>
          ))}
          {!memberships?.length && <p className="text-sm text-dim">Not in any project.</p>}
        </Card>
        <Card title="Hackathons">
          {((parts ?? []) as unknown as H[]).filter((h) => h.hackathons).map((h) => (
            <Link key={h.hackathons!.id} href={`/hackathons/${h.hackathons!.id}`} className="block py-1 text-sm text-silver hover:underline">
              {h.hackathons!.name} <span className="text-dim">· {labelOf(PARTICIPANT_STATUS, h.status)} · via {h.source}</span>
            </Link>
          ))}
          {!parts?.length && <p className="text-sm text-dim">No hackathons.</p>}
        </Card>
      </div>
      <ProfileForm
        mode="staff"
        person={p}
        roles={lookups.roles}
        tags={lookups.tags}
        tagIds={profile.tagIds}
        hackathons={lookups.hackathons}
        hackathonIds={profile.hackathonIds}
      >
        {viewer.isAdmin && <Documents personId={p.id} documents={profile.documents} />}
        {viewer.isAdmin && <DeletePerson id={p.id} label={p.full_name ?? p.email} paths={profile.documents.map((d) => d.storage_path)} />}
      </ProfileForm>
    </div>
  );
}
