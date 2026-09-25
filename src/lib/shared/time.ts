export const EVENT_TZ = "Europe/Stockholm";

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: EVENT_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const timeSecFmt = new Intl.DateTimeFormat("en-GB", { timeZone: EVENT_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: EVENT_TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return timeFmt.format(new Date(iso));
}
export function fmtTimeSec(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return timeSecFmt.format(new Date(iso));
}
export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFmt.format(new Date(iso));
}

/** Offset (ms) of Europe/Stockholm relative to UTC at the given instant. */
function tzOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-09-26T11:00" interpreted as Europe/Stockholm wall-clock time → ISO UTC string. */
export function stockholmLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let guess = wall - tzOffsetMs(wall);
  guess = wall - tzOffsetMs(guess);
  return new Date(guess).toISOString();
}

/** ISO → "YYYY-MM-DDTHH:mm" in Europe/Stockholm (for datetime-local inputs). */
export function isoToStockholmLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const d = new Date(t + tzOffsetMs(t));
  return d.toISOString().slice(0, 16);
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
