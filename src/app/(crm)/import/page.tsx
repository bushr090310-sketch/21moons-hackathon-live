import { requireAdmin } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/crm/page-header";
import { ImportTool } from "./import-tool";

export const metadata = { title: "Import participants" };

export default async function ImportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data: hackathons } = await supabase
    .from("hackathons")
    .select("id, name, status, starts_on")
    .order("starts_on", { ascending: false, nullsFirst: false });
  return (
    <>
      <PageHeader
        title="Import participants"
        subtitle="Upload a CSV (e.g. the Luma guest export). Existing people are matched by email and never overwritten — only empty name/phone fields are filled."
      />
      <ImportTool hackathons={hackathons ?? []} />
    </>
  );
}
