"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Card } from "@/components/crm/page-header";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/crm/form";

// Admin GDPR erasure: CV files first, then the person row (cascades tags,
// participation, memberships and document rows). Their login, if any, stays;
// they can remove it themselves via "Delete my data", or an admin in Supabase Auth.
export function DeletePerson({ id, label, paths }: { id: string; label: string; paths: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (!confirm(`Permanently delete ${label} and their files? This cannot be undone.`)) return;
    const sb = supabase();
    if (paths.length) {
      const { error } = await sb.storage.from("profile-documents").remove(paths);
      if (error) return setError(friendlyError(error));
    }
    const { error } = await sb.from("people").delete().eq("id", id);
    if (error) return setError(friendlyError(error));
    router.replace("/people");
    router.refresh();
  }
  return (
    <Card title="Admin · erase person">
      <Button variant="danger" size="sm" onClick={run}>Delete person and files</Button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </Card>
  );
}
