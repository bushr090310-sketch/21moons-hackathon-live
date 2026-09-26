// MVP search: every whitespace-separated term must appear somewhere in the record's
// haystack (name, role, tags, location, projects…). Case- and accent-insensitive,
// so "python malmo" finds a Python developer in Malmö.
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function matchesQuery(haystack: (string | null | undefined)[], q: string | undefined): boolean {
  if (!q?.trim()) return true;
  const hay = fold(haystack.filter(Boolean).join(" \u0001 "));
  return fold(q).split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

/** Start of "today" in Europe/Stockholm (the event's timezone). */
export function startOfTodayStockholm(now = new Date()): Date {
  const tz = "Europe/Stockholm";
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // YYYY-MM-DD
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = name.replace("GMT", "") || "Z"; // "+02:00"
  return new Date(`${ymd}T00:00:00${offset}`);
}
