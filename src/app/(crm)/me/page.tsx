import { requireViewer } from "@/lib/crm/auth";
import { createClient } from "@/lib/supabase/server";
import { loadLookups, loadProfile } from "@/lib/crm/queries";
import { PageHeader } from "@/components/crm/page-header";
import { ProfileForm } from "@/components/crm/profile-form";
import { DeleteAccount, Documents } from "@/components/crm/documents";

export const metadata = { title: "My profile" };

export default async function MePage() {
  const viewer = await requireViewer();
  if (!viewer.personId) {
    return (
      <div className="mx-auto max-w-xl py-10 text-mist">
        <h1 className="mb-2 text-lg font-semibold text-silver">Your profile isn’t linked yet</h1>
        <p>
          Profiles are linked to your login once your email address is confirmed. Check your inbox for the confirmation
          link, then sign in again. If this persists, ask a 21Moons organizer.
        </p>
      </div>
    );
  }
  const sb = await createClient();
  const [lookups, profile] = await Promise.all([loadLookups(sb), loadProfile(sb, viewer.personId)]);
  if (!profile) return <p className="text-mist">Profile not found.</p>;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My profile" subtitle="Takes ~3 minutes. Only the 21Moons team can see it. Everything except consent is optional." />
      <ProfileForm
        mode="self"
        person={profile.person}
        roles={lookups.roles}
        tags={lookups.tags}
        tagIds={profile.tagIds}
        hackathons={lookups.hackathons}
        hackathonIds={profile.hackathonIds}
      >
        <Documents personId={profile.person.id} documents={profile.documents} />
        <DeleteAccount />
      </ProfileForm>
    </div>
  );
}
