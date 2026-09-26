// POST /api/account/delete — GDPR self-delete.
// Runs server-side only; the service-role key never reaches the browser.
// Order: CV files -> person row (cascades memberships, tags, participation, doc rows)
//        -> auth user. Projects survive; their audit columns become null.
// Safe to retry: if the person row is already gone, it just deletes the auth user.
import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server"; // standard @supabase/ssr server client

const BUCKET = "profile-documents";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!, // server-only env var, no NEXT_PUBLIC_ prefix
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: person, error: personErr } = await admin
    .from("people")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (personErr) return fail("lookup", personErr);

  if (person) {
    const { data: files, error: listErr } = await admin.storage
      .from(BUCKET)
      .list(person.id, { limit: 1000 });
    if (listErr) return fail("list files", listErr);

    if (files && files.length > 0) {
      const { error: rmErr } = await admin.storage
        .from(BUCKET)
        .remove(files.map((f) => `${person.id}/${f.name}`));
      if (rmErr) return fail("remove files", rmErr);
    }

    const { error: delErr } = await admin.from("people").delete().eq("id", person.id);
    if (delErr) return fail("delete profile", delErr);
  }

  const { error: authErr } = await admin.auth.admin.deleteUser(user.id);
  if (authErr) return fail("delete account", authErr);

  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}

function fail(step: string, err: { message: string }) {
  console.error(`account delete failed at ${step}:`, err.message);
  return NextResponse.json({ error: `Could not ${step}. Please try again.` }, { status: 500 });
}
