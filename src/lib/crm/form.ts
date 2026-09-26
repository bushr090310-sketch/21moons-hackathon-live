// Helpers shared by the CRM forms.

/** "" -> null, trims. */
export function str(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

/** Accepts "github.com/x" and stores "https://github.com/x" (the DB requires http(s)://). */
export function url(v: string | null | undefined): string | null {
  const t = str(v);
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function int(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Turns Postgres/PostgREST errors into something a person can act on. */
export function friendlyError(e: unknown): string {
  const err = e as { code?: string; message?: string; details?: string } | null;
  const msg = err?.message ?? String(e);
  if (err?.code === "23505") {
    if (msg.includes("people_email_key")) return "A person with this email already exists.";
    if (msg.includes("tags_type_name_key")) return "That tag already exists (it may be waiting for approval).";
    return "That already exists.";
  }
  if (err?.code === "23514") return `A value is not allowed or too long (${msg.replace(/^.*constraint "?([^"]+)"?.*$/, "$1")}).`;
  if (err?.code === "42501") return "You don't have permission to do that.";
  return msg;
}
