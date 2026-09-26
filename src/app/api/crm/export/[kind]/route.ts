import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPeople, loadProjects } from "@/lib/crm/directory";
import { AVAILABILITY, EMPLOYMENT, STAGES, labelOf } from "@/lib/crm/options";

// Staff-only CSV export. Runs as the signed-in user (RLS applies); no service role.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const viewer = await getViewer();
  if (!viewer?.isStaff) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  const { kind } = await params;
  const sb = await createClient();
  let rows: (string | number | null | undefined)[][];
  if (kind === "people") {
    const people = await loadPeople(sb);
    const { data: hk } = await sb.from("hackathons").select("id, name");
    const hName = new Map((hk ?? []).map((h) => [h.id, h.name]));
    rows = [
      ["email", "full_name", "primary_role", "secondary_role", "headline", "location", "availability", "employment", "hours_per_week", "open_to", "skills", "tools", "tech", "projects", "hackathons", "has_login", "source", "created_at"],
      ...people.map((p) => {
        const tags = (t: string) => p.person_tags.filter((x) => x.tags?.type === t).map((x) => x.tags!.name).join("; ");
        return [
          p.email, p.full_name, p.primary_role?.label, p.secondary_role?.label, p.headline, p.location,
          labelOf(AVAILABILITY, p.availability_status), labelOf(EMPLOYMENT, p.employment_status), p.hours_per_week, p.open_to.join("; "),
          tags("skill"), tags("tool"), tags("technology"), p.project_members.map((m) => m.projects?.name).join("; "),
          p.hackathon_participants.map((h) => hName.get(h.hackathon_id)).join("; "), p.auth_user_id ? "yes" : "no", p.source, p.created_at,
        ];
      }),
    ];
  } else if (kind === "projects") {
    const projects = await loadProjects(sb);
    rows = [
      ["name", "tagline", "category", "stage", "status", "hackathon", "team", "tech", "github_url", "live_url", "users", "customers", "revenue", "currency", "continuing", "follow_up", "created_at"],
      ...projects.map((p) => [
        p.name, p.tagline, p.category, labelOf(STAGES, p.stage), p.status, p.hackathon?.name,
        p.project_members.map((m) => `${m.people?.full_name ?? ""} <${m.people?.email ?? ""}> (${m.team_role})`).join("; "),
        p.project_tags.map((t) => t.tags?.name).join("; "), p.github_url, p.live_url, p.users_count, p.customers_count,
        p.revenue_amount, p.revenue_currency, p.continuing_after_hackathon == null ? "" : p.continuing_after_hackathon ? "yes" : "no",
        p.follow_up_status, p.created_at,
      ]),
    ];
  } else {
    return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  }
  const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="21moons-${kind}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

// Quote every cell; neutralise spreadsheet formula injection.
function cell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
