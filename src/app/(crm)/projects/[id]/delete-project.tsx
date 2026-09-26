"use client";
import { useState } from "react";
import { Button } from "@/components/ui";
import { Card } from "@/components/crm/page-header";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/crm/form";

// Admin only (RLS projects_delete). Prefer archiving duplicates; deleting removes memberships and tags.
export function DeleteProject({ id, name }: { id: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (prompt(`Type the project name to permanently delete it:\n${name}`) !== name) return;
    const { error } = await supabase().from("projects").delete().eq("id", id);
    if (error) return setError(friendlyError(error));
    window.location.href = "/projects";
  }
  return (
    <Card title="Admin">
      <Button variant="danger" size="sm" onClick={run}>Delete project</Button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </Card>
  );
}
