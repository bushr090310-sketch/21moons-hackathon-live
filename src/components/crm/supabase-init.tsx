"use client";
import { configureSupabase } from "@/lib/supabase/client";

// Configures the browser Supabase client during render so every child can use it
// (anon key only — access is enforced by RLS).
export function SupabaseInit({ url, anonKey }: { url: string; anonKey: string }) {
  if (url && anonKey) configureSupabase(url, anonKey);
  return null;
}
