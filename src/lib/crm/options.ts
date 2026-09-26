// Option lists mirroring the CHECK constraints in
// supabase/migrations/20260926120000_initial_crm_schema.sql. Keep them in sync.
// (Roles and tags are data, not code — they live in the roles/tags tables.)

export type Option<T extends string = string> = { value: T; label: string };

const opts = <T extends string>(o: [T, string][]): Option<T>[] => o.map(([value, label]) => ({ value, label }));

export const EMPLOYMENT = opts([
  ["employed", "Employed"], ["self_employed", "Self-employed"], ["founder", "Founder"],
  ["student", "Student"], ["between_roles", "Between roles"], ["other", "Other"],
]);

export const AVAILABILITY = opts([
  ["available", "Available"], ["open", "Open to offers"], ["limited", "Limited"], ["unavailable", "Unavailable"],
]);

export const OPEN_TO = opts([
  ["projects", "Projects"], ["employment", "Employment"], ["cofounding", "Co-founding"], ["freelance", "Freelance"],
  ["advising", "Advising"], ["investing", "Investing"], ["mentoring", "Mentoring"],
]);

export const SHARING = opts([
  ["investors", "Investors"], ["recruiters", "Recruiters"], ["partners", "21Moons partners"], ["participants", "Other participants"],
]);

export const STAGES = opts([
  ["idea", "Idea"], ["building", "Building"], ["mvp", "MVP"], ["launched", "Launched"],
  ["has_users", "Has users"], ["has_revenue", "Has revenue"],
]);

export const PROJECT_STATUS = opts([["active", "Active"], ["paused", "Paused"], ["abandoned", "Abandoned"]]);

export const FOLLOW_UP = opts([
  ["none", "None"], ["to_contact", "To contact"], ["contacted", "Contacted"], ["in_progress", "In progress"], ["closed", "Closed"],
]);

export const TEAM_ROLES = opts([
  ["founder", "Founder"], ["developer", "Developer"], ["designer", "Designer"], ["product", "Product"],
  ["marketing", "Marketing"], ["sales", "Sales"], ["other", "Other"],
]);

export const HACKATHON_STATUS = opts([
  ["upcoming", "Upcoming"], ["active", "Active"], ["completed", "Completed"], ["archived", "Archived"],
]);

export const PARTICIPANT_STATUS = opts([
  ["registered", "Registered"], ["checked_in", "Checked in"], ["no_show", "No-show"], ["withdrawn", "Withdrawn"],
]);

export const TAG_TYPES = opts([["skill", "Skills"], ["tool", "Tools"], ["technology", "Tech stack"]]);
export type TagType = "skill" | "tool" | "technology";

export function labelOf(list: Option[], value: string | null | undefined): string {
  if (!value) return "—";
  return list.find((o) => o.value === value)?.label ?? value;
}
