"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { CheckGroup, Field, Section } from "@/components/crm/field";
import { TagPicker } from "@/components/crm/tag-picker";
import { supabase } from "@/lib/supabase/client";
import { friendlyError, int, str, url } from "@/lib/crm/form";
import { AVAILABILITY, EMPLOYMENT, OPEN_TO, SHARING, TAG_TYPES, type TagType } from "@/lib/crm/options";
import type { HackathonLite, Person, Role, Tag } from "@/lib/crm/types";

type Mode = "self" | "staff";

type Draft = Record<
  | "full_name" | "email" | "phone" | "location" | "timezone" | "primary_role_id" | "secondary_role_id" | "headline"
  | "short_bio" | "experience_summary" | "years_experience" | "availability_status" | "employment_status"
  | "hours_per_week" | "linkedin_url" | "github_url" | "portfolio_url" | "website_url" | "additional_info",
  string
>;

function toDraft(p: Person | null): Draft {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    full_name: s(p?.full_name), email: s(p?.email), phone: s(p?.phone), location: s(p?.location),
    timezone: s(p?.timezone ?? (p ? "" : Intl.DateTimeFormat().resolvedOptions().timeZone)),
    primary_role_id: s(p?.primary_role_id), secondary_role_id: s(p?.secondary_role_id), headline: s(p?.headline),
    short_bio: s(p?.short_bio), experience_summary: s(p?.experience_summary), years_experience: s(p?.years_experience),
    availability_status: s(p?.availability_status), employment_status: s(p?.employment_status), hours_per_week: s(p?.hours_per_week),
    linkedin_url: s(p?.linkedin_url), github_url: s(p?.github_url), portfolio_url: s(p?.portfolio_url),
    website_url: s(p?.website_url), additional_info: s(p?.additional_info),
  };
}

export function ProfileForm({
  mode, person, roles, tags: initialTags, tagIds, hackathons, hackathonIds, children,
}: {
  mode: Mode;
  person: Person | null; // null = staff creating a new person
  roles: Role[];
  tags: Tag[];
  tagIds: string[];
  hackathons: HackathonLite[];
  hackathonIds: string[];
  children?: React.ReactNode; // extra sections (documents, danger zone) rendered below
}) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => toDraft(person));
  const [openTo, setOpenTo] = useState<string[]>(person?.open_to ?? []);
  const [sharing, setSharing] = useState<string[]>(person?.sharing_opt_ins ?? []);
  const [consent, setConsent] = useState<boolean>(!!person?.privacy_consent_at);
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [selTags, setSelTags] = useState<string[]>(tagIds);
  const [selHack, setSelHack] = useState<string[]>(hackathonIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setD((prev) => ({ ...prev, [k]: e.target.value }));

  // Participants can join/leave upcoming or active hackathons (RLS hp_insert); staff can manage any.
  const joinable = hackathons.filter((h) => mode === "staff" || ["upcoming", "active"].includes(h.status) || hackathonIds.includes(h.id));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "self" && !consent) {
      setError("Please confirm the privacy notice in section 8 to save your profile.");
      return;
    }
    if (d.primary_role_id && d.primary_role_id === d.secondary_role_id) {
      setError("Primary and secondary role should differ.");
      return;
    }
    setBusy(true);
    const sb = supabase();
    try {
      const now = new Date().toISOString();
      const fields = {
        full_name: str(d.full_name), phone: str(d.phone), location: str(d.location), timezone: str(d.timezone),
        primary_role_id: int(d.primary_role_id), secondary_role_id: int(d.secondary_role_id), headline: str(d.headline),
        short_bio: str(d.short_bio), experience_summary: str(d.experience_summary), years_experience: int(d.years_experience),
        availability_status: str(d.availability_status), employment_status: str(d.employment_status),
        hours_per_week: int(d.hours_per_week), open_to: openTo,
        linkedin_url: url(d.linkedin_url), github_url: url(d.github_url), portfolio_url: url(d.portfolio_url),
        website_url: url(d.website_url), additional_info: str(d.additional_info),
        sharing_opt_ins: sharing,
        ...(mode === "self"
          ? {
              privacy_consent_at: person?.privacy_consent_at ?? now,
              sharing_consent_at:
                JSON.stringify([...sharing].sort()) === JSON.stringify([...(person?.sharing_opt_ins ?? [])].sort())
                  ? (person?.sharing_consent_at ?? null)
                  : sharing.length ? now : null,
            }
          : {}),
      };

      let id = person?.id;
      if (!id) {
        const email = str(d.email)?.toLowerCase();
        if (!email) throw new Error("Email is required.");
        const { data, error } = await sb.from("people").insert({ ...fields, email, source: "admin" }).select("id").single();
        if (error) throw error;
        id = data.id as string;
      } else {
        const patch = mode === "staff" && str(d.email) && str(d.email)!.toLowerCase() !== person!.email ? { ...fields, email: str(d.email)!.toLowerCase() } : fields;
        const { error } = await sb.from("people").update(patch).eq("id", id);
        if (error) throw error;
      }

      // Tags: remove deselected, add new (idempotent).
      const removed = tagIds.filter((t) => !selTags.includes(t));
      if (removed.length) {
        const { error } = await sb.from("person_tags").delete().eq("person_id", id).in("tag_id", removed);
        if (error) throw error;
      }
      const added = selTags.filter((t) => !tagIds.includes(t));
      if (added.length) {
        const { error } = await sb.from("person_tags").upsert(added.map((tag_id) => ({ person_id: id, tag_id })), { onConflict: "person_id,tag_id", ignoreDuplicates: true });
        if (error) throw error;
      }

      // Hackathon participation.
      const left = hackathonIds.filter((h) => !selHack.includes(h));
      if (left.length) {
        const { error } = await sb.from("hackathon_participants").delete().eq("person_id", id).in("hackathon_id", left);
        if (error) throw error;
      }
      const joined = selHack.filter((h) => !hackathonIds.includes(h));
      if (joined.length) {
        const { error } = await sb.from("hackathon_participants").upsert(
          joined.map((hackathon_id) => ({ hackathon_id, person_id: id, source: mode === "self" ? "self" : "admin" })),
          { onConflict: "hackathon_id,person_id", ignoreDuplicates: true },
        );
        if (error) throw error;
      }

      toast.success("Profile saved");
      if (!person) router.replace(`/people/${id}`);
      router.refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
    <form onSubmit={save} className="space-y-4">
      <Section n={1} title="About you">
        <Field label="Full name"><Input value={d.full_name} onChange={set("full_name")} maxLength={120} autoComplete="name" /></Field>
        <Field label="Email" hint={mode === "self" ? "linked to your login" : undefined}>
          <Input type="email" value={d.email} onChange={set("email")} disabled={mode === "self"} required={!person} />
        </Field>
        <Field label="Phone" hint="optional"><Input value={d.phone} onChange={set("phone")} maxLength={40} autoComplete="tel" /></Field>
        <Field label="Location" hint="city, country"><Input value={d.location} onChange={set("location")} maxLength={120} placeholder="Malmö, Sweden" /></Field>
      </Section>

      <Section n={2} title="What you do">
        <Field label="Primary role">
          <Select value={d.primary_role_id} onChange={set("primary_role_id")}>
            <option value="">—</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Secondary role" hint="optional">
          <Select value={d.secondary_role_id} onChange={set("secondary_role_id")}>
            <option value="">—</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Headline" className="md:col-span-2"><Input value={d.headline} onChange={set("headline")} maxLength={160} placeholder="Full-stack dev building AI tools for healthcare" /></Field>
        <Field label="Short bio" className="md:col-span-2"><Textarea rows={3} value={d.short_bio} onChange={set("short_bio")} maxLength={2000} /></Field>
        <Field label="Experience" hint="companies, startups, hackathon wins…" className="md:col-span-2"><Textarea rows={3} value={d.experience_summary} onChange={set("experience_summary")} maxLength={4000} /></Field>
        <Field label="Years of experience"><Input type="number" min={0} max={80} value={d.years_experience} onChange={set("years_experience")} /></Field>
      </Section>

      <Section n={3} title="Skills & technology" desc="Pick from the list or add a new one.">
        {TAG_TYPES.map((t) => (
          <Field key={t.value} label={t.label} className={t.value === "technology" ? "md:col-span-2" : ""}>
            <TagPicker
              type={t.value as TagType}
              tags={tags}
              selected={selTags.filter((id) => tags.find((x) => x.id === id)?.type === t.value)}
              onChange={(ids) => setSelTags([...selTags.filter((id) => tags.find((x) => x.id === id)?.type !== t.value), ...ids])}
              onCreated={(tag) => setTags((prev) => [...prev, tag])}
              placeholder={{ skill: "e.g. Growth, UX research", tool: "e.g. Figma, Notion", technology: "e.g. Python, React" }[t.value as TagType]}
            />
          </Field>
        ))}
      </Section>

      <Section n={4} title="Availability">
        <Field label="Availability">
          <Select value={d.availability_status} onChange={set("availability_status")}>
            <option value="">—</option>
            {AVAILABILITY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Current situation">
          <Select value={d.employment_status} onChange={set("employment_status")}>
            <option value="">—</option>
            {EMPLOYMENT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Hours / week available"><Input type="number" min={0} max={80} value={d.hours_per_week} onChange={set("hours_per_week")} /></Field>
        <Field label="Timezone"><Input value={d.timezone} onChange={set("timezone")} maxLength={64} placeholder="Europe/Stockholm" /></Field>
        <div className="md:col-span-2">
          <Field label="Open to"><span /></Field>
          <CheckGroup options={OPEN_TO} value={openTo} onChange={setOpenTo} />
        </div>
      </Section>

      <Section n={5} title="Links">
        <Field label="LinkedIn"><Input value={d.linkedin_url} onChange={set("linkedin_url")} placeholder="linkedin.com/in/…" /></Field>
        <Field label="GitHub"><Input value={d.github_url} onChange={set("github_url")} placeholder="github.com/…" /></Field>
        <Field label="Portfolio"><Input value={d.portfolio_url} onChange={set("portfolio_url")} /></Field>
        <Field label="Website"><Input value={d.website_url} onChange={set("website_url")} /></Field>
      </Section>

      <Section n={6} title="Hackathons" desc={mode === "self" ? "Tick the 21Moons hackathons you are taking part in." : undefined}>
        <div className="md:col-span-2">
          {joinable.length === 0 ? <p className="text-sm text-dim">No open hackathons.</p> : (
            <CheckGroup options={joinable.map((h) => ({ value: h.id, label: `${h.name}${h.starts_on ? ` · ${h.starts_on}` : ""}` }))} value={selHack} onChange={setSelHack} />
          )}
        </div>
      </Section>

      <Section n={7} title="Anything else">
        <Field label="Other / additional information" className="md:col-span-2"><Textarea rows={3} value={d.additional_info} onChange={set("additional_info")} maxLength={4000} /></Field>
      </Section>

      <Section n={8} title="Privacy" desc="Your profile is internal to the 21Moons team. Nothing is shared externally today.">
        <div className="space-y-3 md:col-span-2">
          {mode === "self" && (
            <label className="flex items-start gap-2 text-sm text-mist">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={!!person?.privacy_consent_at} className="mt-1" />
              <span>
                I agree that 21Moons stores this profile to run its hackathons and community, and that I can edit or delete it at any time.
                {person?.privacy_consent_at && <span className="text-dim"> (given {new Date(person.privacy_consent_at).toLocaleDateString()})</span>}
              </span>
            </label>
          )}
          <div>
            <p className="mb-2 text-sm text-mist">In the future, 21Moons may introduce me to (optional):</p>
            <CheckGroup options={SHARING} value={sharing} onChange={setSharing} />
          </div>
        </div>
      </Section>

      {error && <p className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-void/90 px-4 py-3 backdrop-blur">
        {person && <span className="mr-auto text-xs text-dim">Last updated {new Date(person.updated_at).toLocaleString()}</span>}
        <Button type="submit" variant="primary" loading={busy}>{person ? "Save profile" : "Create person"}</Button>
      </div>
    </form>
    {children}
    </div>
  );
}
