import { requireStaff } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/crm/page-header";
import { TagAdmin } from "./tag-admin";
import type { Tag } from "@/lib/crm/types";

export const metadata = { title: "Skills, tools & tech" };

export default async function TagsPage() {
  await requireStaff();
  const sb = await createClient();
  const [{ data: tags }, { data: pt }, { data: prt }] = await Promise.all([
    sb.from("tags").select("id, type, name, approved").order("approved").order("name").limit(5000),
    sb.from("person_tags").select("tag_id").limit(50000),
    sb.from("project_tags").select("tag_id").limit(50000),
  ]);
  const usage: Record<string, number> = {};
  [...(pt ?? []), ...(prt ?? [])].forEach((r: { tag_id: string }) => (usage[r.tag_id] = (usage[r.tag_id] ?? 0) + 1));
  return (
    <>
      <PageHeader title="Skills, tools & tech" subtitle="Approve suggestions, fix spelling, or add values. Changes need no migration." />
      <TagAdmin tags={(tags ?? []) as Tag[]} usage={usage} />
    </>
  );
}
