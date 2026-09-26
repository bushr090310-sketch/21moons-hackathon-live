import { createClient } from "@/lib/supabase/server";
import type { HackathonLite, Person, ProfileDocument, Role, Tag } from "./types";

type Sb = Awaited<ReturnType<typeof createClient>>;

export async function loadLookups(sb: Sb) {
  const [roles, tags, hackathons] = await Promise.all([
    sb.from("roles").select("id, slug, label").eq("is_active", true).order("sort_order"),
    sb.from("tags").select("id, type, name, approved").order("name").limit(5000),
    sb.from("hackathons").select("id, name, status, starts_on, location").order("starts_on", { ascending: false, nullsFirst: false }),
  ]);
  return {
    roles: (roles.data ?? []) as Role[],
    tags: (tags.data ?? []) as Tag[],
    hackathons: (hackathons.data ?? []) as HackathonLite[],
  };
}

/** Everything the profile form needs. RLS decides what the caller may see. */
export async function loadProfile(sb: Sb, personId: string) {
  const [person, tagRows, parts, docs] = await Promise.all([
    sb.from("people").select("*").eq("id", personId).maybeSingle(),
    sb.from("person_tags").select("tag_id").eq("person_id", personId),
    sb.from("hackathon_participants").select("hackathon_id, status").eq("person_id", personId),
    sb.from("profile_documents").select("id, kind, storage_path, file_name, size_bytes, uploaded_at").eq("person_id", personId).order("uploaded_at", { ascending: false }),
  ]);
  if (!person.data) return null;
  return {
    person: person.data as Person,
    tagIds: (tagRows.data ?? []).map((r: { tag_id: string }) => r.tag_id),
    hackathonIds: (parts.data ?? []).map((r: { hackathon_id: string }) => r.hackathon_id),
    documents: (docs.data ?? []) as ProfileDocument[],
  };
}
