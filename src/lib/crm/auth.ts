import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "admin" | "staff" | "participant";

export interface Viewer {
  userId: string;
  email: string;
  role: AppRole;
  isStaff: boolean;
  isAdmin: boolean;
  /** The linked people row; null until the email is confirmed. */
  personId: string | null;
  fullName: string | null;
}

// One lookup per request. Role comes from user_roles (RLS: you can read your own row).
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: roleRow }, { data: person }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    supabase.from("people").select("id, full_name").eq("auth_user_id", user.id).maybeSingle(),
  ]);
  const role: AppRole = roleRow?.role === "admin" ? "admin" : roleRow?.role === "staff" ? "staff" : "participant";
  return {
    userId: user.id,
    email: user.email ?? "",
    role,
    isStaff: role !== "participant",
    isAdmin: role === "admin",
    personId: person?.id ?? null,
    fullName: person?.full_name ?? null,
  };
});

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  return v;
}

/** Staff/admin-only pages. Participants are sent to their own profile. */
export async function requireStaff(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.isStaff) redirect("/me");
  return v;
}

export async function requireAdmin(): Promise<Viewer> {
  const v = await requireViewer();
  if (!v.isAdmin) redirect(v.isStaff ? "/dashboard" : "/me");
  return v;
}
