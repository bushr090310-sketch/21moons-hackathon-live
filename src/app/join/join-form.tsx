"use client";

import { useState, type FormEvent } from "react";

const field = "mt-1 block w-full rounded-lg border border-line-strong bg-ink-2 px-3 py-3 text-silver outline-none focus:border-violet";

export function JoinForm() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/crm/join", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.get("name"), email: form.get("email"), role: form.get("role"),
          skills: form.get("skills"), project: form.get("project"), website: form.get("website"), consent: form.get("consent") === "on" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your details.");
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setPending(false); }
  }
  if (done) return <div role="status" className="panel p-8"><h2 className="text-2xl font-semibold">You&apos;re in. Thank you!</h2>
    <p className="mt-3 text-mist">Your details were saved. You can add more to your profile later.</p></div>;
  return <form onSubmit={submit} className="panel space-y-5 p-5 sm:p-7">
    <label className="block text-sm">Full name *<input className={field} name="name" autoComplete="name" required minLength={2} maxLength={120} /></label>
    <label className="block text-sm">Email *<input className={field} name="email" autoComplete="email" type="email" required maxLength={254} /></label>
    <label className="block text-sm">What do you do? <span className="text-mist">(optional)</span><input className={field} name="role" placeholder="Developer, designer, founder..." maxLength={120} /></label>
    <label className="block text-sm">Skills or tools <span className="text-mist">(optional)</span><input className={field} name="skills" placeholder="React, Figma, sales..." maxLength={500} /></label>
    <label className="block text-sm">Project name <span className="text-mist">(optional)</span><input className={field} name="project" maxLength={120} /></label>
    <div className="hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <label className="flex gap-3 text-sm leading-5 text-mist"><input type="checkbox" name="consent" required className="mt-1" />
      <span>I agree that 21Moons stores my details internally to run hackathons and follow up with me. My data is not publicly listed or shared externally without separate permission. I can ask an organizer to access or remove it.</span></label>
    {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    <button disabled={pending} type="submit" className="w-full rounded-lg bg-violet px-5 py-3 font-semibold text-void disabled:opacity-50">{pending ? "Saving..." : "Save my details"}</button>
  </form>;
}
