import Link from "next/link";
import { requireStaff } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/crm/page-header";
import { HackathonForm } from "@/components/crm/hackathon-form";
import { Badge } from "@/components/ui";

export const metadata = { title: "Hackathons" };

export default async function HackathonsPage() {
  const viewer = await requireStaff();
  const sb = await createClient();
  const [{ data: hackathons }, { data: parts }, { data: projects }] = await Promise.all([
    sb.from("hackathons").select("id, name, starts_on, location, status").order("starts_on", { ascending: false, nullsFirst: false }),
    sb.from("hackathon_participants").select("hackathon_id"),
    sb.from("projects").select("origin_hackathon_id"),
  ]);
  const count = (rows: Record<string, unknown>[] | null, key: string, id: string) => (rows ?? []).filter((r) => r[key] === id).length;
  return (
    <div className="space-y-4">
      <PageHeader title="Hackathons" />
      <div className="overflow-x-auto rounded-xl border border-line bg-ink/70">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wider text-dim">
            <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Location</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Participants</th><th className="px-3 py-2 text-right">Projects</th></tr>
          </thead>
          <tbody>
            {(hackathons ?? []).map((h) => (
              <tr key={h.id} className="border-t border-line">
                <td className="px-3 py-2"><Link href={`/hackathons/${h.id}`} className="font-medium text-silver hover:underline">{h.name}</Link></td>
                <td className="px-3 py-2 text-mist">{h.starts_on ?? "—"}</td>
                <td className="px-3 py-2 text-mist">{h.location ?? "—"}</td>
                <td className="px-3 py-2"><Badge tone={h.status === "active" ? "ok" : "neutral"}>{h.status}</Badge></td>
                <td className="px-3 py-2 text-right tabular-nums">{count(parts, "hackathon_id", h.id)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{count(projects, "origin_hackathon_id", h.id)}</td>
              </tr>
            ))}
            {!hackathons?.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-mist">No hackathons yet{viewer.isAdmin ? " — create one below or run supabase/seed.sql." : "."}</td></tr>}
          </tbody>
        </table>
      </div>
      {viewer.isAdmin && <Card title="New hackathon"><HackathonForm /></Card>}
    </div>
  );
}
