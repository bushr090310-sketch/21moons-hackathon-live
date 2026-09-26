import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db, withTx } from "@/lib/server/db";

const body = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254).transform((s) => s.trim().toLowerCase()),
  role: z.string().trim().max(120).optional(),
  skills: z.string().trim().max(500).optional(),
  project: z.string().trim().max(120).optional(),
  consent: z.literal(true),
  website: z.string().max(0), // hidden honeypot
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let input: z.infer<typeof body>;
  try { input = body.parse(await request.json()); }
  catch { return NextResponse.json({ error: "Check the fields and try again." }, { status: 400 }); }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    // A shared database throttle works across Vercel instances. This route never
    // returns whether an email was already present in the CRM.
    const [limit] = await db()`select count(*)::int as n from auth_attempts
      where kind = 'crm_join' and key = ${ip} and created_at > now() - interval '1 hour'`;
    if (limit.n >= 20) return NextResponse.json({ error: "Too many submissions. Ask an organizer." }, { status: 429 });
    await withTx(async (tx) => {
      await tx`insert into auth_attempts (kind, key) values ('crm_join', ${ip})`;
      const [event] = await tx`select id from public.hackathons
        where slug = 'hackathon-winners-ultimate-malmo-2026'`;
      if (!event) throw new Error("Event not configured");
      await tx`
        insert into public.people (email, full_name, headline, additional_info, privacy_consent_at, source)
        values (${input.email}, ${input.name}, ${input.role || null},
          ${[input.skills && `Skills: ${input.skills}`, input.project && `Project: ${input.project}`].filter(Boolean).join("\n") || null},
          now(), 'self')
        on conflict (email) do nothing`;
      const [person] = await tx`select id from public.people where email = ${input.email}`;
      await tx`insert into public.hackathon_participants (hackathon_id, person_id, source)
        values (${event.id}, ${person.id}, 'self') on conflict do nothing`;
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("CRM registration failed", err);
    return NextResponse.json({ error: "Could not save your details. Please tell an organizer." }, { status: 500 });
  }
}
