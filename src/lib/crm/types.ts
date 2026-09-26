import type { TagType } from "./options";

export interface Role { id: number; slug: string; label: string }
export interface Tag { id: string; type: TagType; name: string; approved: boolean }
export interface HackathonLite { id: string; name: string; status: string; starts_on: string | null; location?: string | null }

export interface Person {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  primary_role_id: number | null;
  secondary_role_id: number | null;
  headline: string | null;
  short_bio: string | null;
  experience_summary: string | null;
  years_experience: number | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  website_url: string | null;
  location: string | null;
  timezone: string | null;
  employment_status: string | null;
  availability_status: string | null;
  hours_per_week: number | null;
  open_to: string[];
  additional_info: string | null;
  privacy_consent_at: string | null;
  sharing_opt_ins: string[];
  sharing_consent_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileDocument {
  id: string;
  kind: "cv" | "linkedin_pdf" | "other";
  storage_path: string;
  file_name: string;
  size_bytes: number | null;
  uploaded_at: string;
}

export interface Project {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  problem: string | null;
  solution: string | null;
  category: string | null;
  stage: string;
  status: string;
  origin_hackathon_id: string | null;
  continuing_after_hackathon: boolean | null;
  follow_up_status: string;
  github_url: string | null;
  live_url: string | null;
  demo_url: string | null;
  presentation_url: string | null;
  users_count: number | null;
  customers_count: number | null;
  pilots_count: number | null;
  meetings_count: number | null;
  commitments_count: number | null;
  revenue_amount: number | null;
  revenue_currency: string | null;
  traction_notes: string | null;
  next_steps: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMember { person_id: string; full_name: string | null; team_role: string; is_lead: boolean; primary_role: string | null }
