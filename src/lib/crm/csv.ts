// Small RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, BOM).
// Also sniffs ";" and tab delimiters, which Excel exports in some locales.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") === -1 ? src.length : src.indexOf("\n"));
  const delim = [",", ";", "\t"].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function count(s: string, ch: string) {
  return s.split(ch).length - 1;
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type ImportField = "email" | "full_name" | "first_name" | "last_name" | "phone" | "external_ref";

export const IMPORT_FIELDS: { key: ImportField; label: string; guesses: string[] }[] = [
  { key: "email", label: "Email *", guesses: ["email", "e-mail", "email address", "mail"] },
  { key: "full_name", label: "Full name", guesses: ["name", "full name", "full_name", "fullname"] },
  { key: "first_name", label: "First name", guesses: ["first_name", "first name", "firstname", "given name"] },
  { key: "last_name", label: "Last name", guesses: ["last_name", "last name", "lastname", "surname", "family name"] },
  { key: "phone", label: "Phone", guesses: ["phone_number", "phone", "phone number", "mobile", "telephone"] },
  { key: "external_ref", label: "External ID (e.g. Luma guest ID)", guesses: ["api_id", "guest_id", "guest id", "id", "ticket id"] },
];

/** Picks a column index per field from the header row (exact match first, then prefix). */
export function guessMapping(headers: string[]): Record<ImportField, number> {
  const norm = headers.map((h) => h.trim().toLowerCase());
  const out = {} as Record<ImportField, number>;
  for (const f of IMPORT_FIELDS) {
    let idx = norm.findIndex((h) => f.guesses.includes(h));
    if (idx === -1) idx = norm.findIndex((h) => f.guesses.some((g) => h.startsWith(g)));
    out[f.key] = idx;
  }
  return out;
}

export interface ImportRow {
  line: number; // 1-based line in the file (header = 1)
  email: string;
  full_name: string;
  phone: string;
  external_ref: string;
  problems: string[];
  duplicateOf: number | null; // earlier line with the same email
}

export function buildRows(data: string[][], mapping: Record<ImportField, number>): ImportRow[] {
  const get = (r: string[], k: ImportField) => (mapping[k] >= 0 ? (r[mapping[k]] ?? "").trim() : "");
  const seen = new Map<string, number>();
  return data.map((r, i) => {
    const line = i + 2;
    const email = get(r, "email").toLowerCase();
    const full = get(r, "full_name") || [get(r, "first_name"), get(r, "last_name")].filter(Boolean).join(" ");
    const problems: string[] = [];
    if (!email) problems.push("missing email");
    else if (!EMAIL_RE.test(email)) problems.push("invalid email");
    if (full.length > 120) problems.push("name longer than 120 chars");
    const phone = get(r, "phone");
    if (phone.length > 40) problems.push("phone longer than 40 chars");
    const dup = email ? (seen.get(email) ?? null) : null;
    if (email && dup === null) seen.set(email, line);
    return { line, email, full_name: full, phone, external_ref: get(r, "external_ref"), problems, duplicateOf: dup };
  });
}
