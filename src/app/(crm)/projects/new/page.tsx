import { requireViewer } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadLookups } from "@/lib/crm/queries";
import { PageHeader } from "@/components/crm/page-header";
import { ProjectForm } from "@/components/crm/project-form";

export const metadata = { title: "Submit a project" };

export default async function NewProjectPage() {
  const viewer = await requireViewer();
  const { tags, hackathons } = await loadLookups(await createClient());
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Submit a project" subtitle="Only the name is required — you and your team can keep editing it later." />
      <ProjectForm project={null} isStaff={viewer.isStaff} hackathons={hackathons} tags={tags} tagIds={[]} />
    </div>
  );
}
