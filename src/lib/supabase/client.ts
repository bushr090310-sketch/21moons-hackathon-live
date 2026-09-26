"use client";
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

// Browser client. The URL/key are passed down from the server (see CrmShell) so they
// are read at request time, like the rest of the app, instead of being inlined at build.
export function configureSupabase(url: string, key: string) {
  if (!client) client = createBrowserClient(url, key);
}

export function supabase() {
  if (!client) throw new Error("Supabase is not configured");
  return client;
}
