import type { Metadata } from "next";
import { CrmNav } from "@/components/crm/nav";
import { SupabaseInit } from "@/components/crm/supabase-init";
import { getViewer } from "@/lib/crm/auth";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

export const metadata: Metadata = { title: { default: "CRM", template: "%s · 21Moons CRM" } };

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  const viewer = url && key ? await getViewer() : null;
  const items = !viewer
    ? []
    : viewer.isStaff
      ? [
          { href: "/dashboard", label: "Dashboard" },
          { href: "/people", label: "People" },
          { href: "/projects", label: "Projects" },
          { href: "/hackathons", label: "Hackathons" },
          ...(viewer.isAdmin ? [{ href: "/import", label: "Import" }, { href: "/tags", label: "Tags" }] : [{ href: "/tags", label: "Tags" }]),
          { href: "/me", label: "My profile" },
        ]
      : [
          { href: "/me", label: "My profile" },
          { href: "/me/projects", label: "My projects" },
        ];
  return (
    <>
      <SupabaseInit url={url} anonKey={key} />
      {viewer && <CrmNav items={items} email={viewer.email} role={viewer.role} />}
      {!url || !key ? (
        <main className="mx-auto max-w-xl px-4 py-16 text-mist">
          Supabase is not configured. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
        </main>
      ) : (
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      )}
    </>
  );
}
