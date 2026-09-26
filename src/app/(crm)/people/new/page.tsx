import { requireStaff } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadLookups } from "@/lib/crm/queries";
import { PageHeader } from "@/components/crm/page-header";
import { ProfileForm } from "@/components/crm/profile-form";

export const metadata = { title: "Add person" };

export default async function NewPersonPage() {
  await requireStaff();
  const lookups = await loadLookups(await createClient());
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add person" subtitle="The profile links automatically when this person signs in with the same email." />
      <ProfileForm mode="staff" person={null} roles={lookups.roles} tags={lookups.tags} tagIds={[]} hackathons={lookups.hackathons} hackathonIds={[]} />
    </div>
  );
}
