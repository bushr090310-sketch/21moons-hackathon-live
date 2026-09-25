import { NextResponse } from "next/server";
import { adminPasswordFingerprint, sign, verify } from "./crypto";
import { db } from "./db";
import { AppError, unauthorized } from "./errors";

export const ADMIN_COOKIE = "moons_admin";
export const TEAM_COOKIE = "moons_team";
const ADMIN_TTL_S = 18 * 3600;
const TEAM_TTL_S = 36 * 3600;

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// --- Admin --------------------------------------------------------------------
interface AdminPayload { r: "admin"; pw: string; exp: number }

export function isAdmin(req: Request): boolean {
  const fp = adminPasswordFingerprint();
  if (!fp) return false;
  const p = verify<AdminPayload>(readCookie(req, ADMIN_COOKIE));
  return !!p && p.r === "admin" && p.pw === fp;
}

export function requireAdmin(req: Request): void {
  if (!process.env.ADMIN_PASSWORD) throw new AppError(503, "ADMIN_PASSWORD is not configured on the server.");
  if (!isAdmin(req)) throw unauthorized("Organizer login required");
}

export function setAdminCookie(res: NextResponse) {
  const token = sign({ r: "admin", pw: adminPasswordFingerprint(), exp: Date.now() + ADMIN_TTL_S * 1000 });
  res.cookies.set(ADMIN_COOKIE, token, cookieOptions(ADMIN_TTL_S));
}

export function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, "", { ...cookieOptions(0), maxAge: 0 });
}

// --- Team ---------------------------------------------------------------------
interface TeamPayload { r: "team"; tid: string; sv: number; exp: number }

export function setTeamCookie(res: NextResponse, teamId: string, sessionVersion: number) {
  const token = sign({ r: "team", tid: teamId, sv: sessionVersion, exp: Date.now() + TEAM_TTL_S * 1000 });
  res.cookies.set(TEAM_COOKIE, token, cookieOptions(TEAM_TTL_S));
}

export interface TeamSession { teamId: string; name: string }

/** Team identity is ONLY derived from the signed cookie, re-validated against the DB. */
export async function getTeamSession(req: Request): Promise<TeamSession | null> {
  const p = verify<TeamPayload>(readCookie(req, TEAM_COOKIE));
  if (!p || p.r !== "team" || typeof p.tid !== "string") return null;
  const rows = await db()`
    select t.id, t.name from teams t join team_secrets s on s.team_id = t.id
    where t.id = ${p.tid} and t.active and s.session_version = ${p.sv}`;
  if (!rows.length) return null;
  return { teamId: rows[0].id, name: rows[0].name };
}

export async function requireTeam(req: Request): Promise<TeamSession> {
  const s = await getTeamSession(req);
  if (!s) throw unauthorized("Team login required");
  return s;
}
