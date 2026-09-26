import { createClient } from "@/lib/supabase/server";
import { AVAILABILITY, EMPLOYMENT, labelOf, OPEN_TO, STAGES, PROJECT_STATUS } from "./options";
import type { Tag } from "./types";

type Sb = Awaited<ReturnType<typeof createClient>>;

// The directory loads the whole (small) dataset once and filters in memory.
// Fine for thousands of rows; move filtering into SQL/RPC when it outgrows that.
const LIMIT = 5000;

export interface PersonRow {
  id: string;
  email: string;
  full_name: string | null;
  headline: string | null;
  short_bio: string | null;
  experience_summary: string | null;
  location: string | null;
  availability_status: string | null;
  employment_status: string | null;
  open_to: string[];
  hours_per_week: number | null;
  auth_user_id: string | null;
  source: string;
  created_at: string;
  primary_role_id: number | null;
  secondary_role_id: number | null;
  primary_role: { label: string } | null;
  secondary_role: { label: string } | null;
  person_tags: { tags: Tag | null }[];
  hackathon_participants: { hackathon_id: string; status: string }[];
  project_members: { team_role: string; projects: { id: string; name: string; origin_hackathon_id: string | null } | null }[];
}

export async function loadPeople(sb: Sb): Promise<PersonRow[]> {
  const { data, error } = await sb
    .from("people")
    .select(
      `id, email, full_name, headline, short_bio, experience_summary, location, availability_status, employment_status,
       open_to, hours_per_week, auth_user_id, source, created_at, primary_role_id, secondary_role_id,
       primary_role:roles!people_primary_role_id_fkey(label),
       secondary_role:roles!people_secondary_role_id_fkey(label),
       person_tags(tags(id, type, name, approved)),
       hackathon_participants(hackathon_id, status),
       project_members(team_role, projects(id, name, origin_hackathon_id))`,
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(`Could not load people: ${error.message}`);
  return (data ?? []) as unknown as PersonRow[];
}

export function personHaystack(p: PersonRow): string[] {
  return [
    p.full_name, p.email, p.headline, p.short_bio, p.experience_summary, p.location,
    p.primary_role?.label, p.secondary_role?.label, labelOf(AVAILABILITY, p.availability_status),
    labelOf(EMPLOYMENT, p.employment_status), ...p.open_to.map((o) => labelOf(OPEN_TO, o)),
    ...p.person_tags.map((t) => t.tags?.name), ...p.project_members.map((m) => m.projects?.name),
  ].filter((x): x is string => !!x);
}

export interface ProjectRow {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  problem: string | null;
  solution: string | null;
  category: string | null;
  stage: string;
  status: string;
  follow_up_status: string;
  continuing_after_hackathon: boolean | null;
  github_url: string | null;
  live_url: string | null;
  origin_hackathon_id: string | null;
  archived_at: string | null;
  created_at: string;
  users_count: number | null;
  customers_count: number | null;
  revenue_amount: number | null;
  revenue_currency: string | null;
  hackathon: { id: string; name: string } | null;
  project_tags: { tags: Tag | null }[];
  project_members: { team_role: string; is_lead: boolean; people: { id: string; full_name: string | null; email: string } | null }[];
}

export async function loadProjects(sb: Sb): Promise<ProjectRow[]> {
  const { data, error } = await sb
    .from("projects")
    .select(
      `id, name, tagline, description, problem, solution, category, stage, status, follow_up_status,
       continuing_after_hackathon, github_url, live_url, origin_hackathon_id, archived_at, created_at,
       users_count, customers_count, revenue_amount, revenue_currency,
       hackathon:hackathons(id, name),
       project_tags(tags(id, type, name, approved)),
       project_members(team_role, is_lead, people(id, full_name, email))`,
    )
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  return (data ?? []) as unknown as ProjectRow[];
}

export function projectHaystack(p: ProjectRow): string[] {
  return [
    p.name, p.tagline, p.description, p.problem, p.solution, p.category, labelOf(STAGES, p.stage),
    labelOf(PROJECT_STATUS, p.status), p.hackathon?.name, ...p.project_tags.map((t) => t.tags?.name),
    ...p.project_members.flatMap((m) => [m.people?.full_name, m.people?.email]),
  ].filter((x): x is string => !!x);
}
