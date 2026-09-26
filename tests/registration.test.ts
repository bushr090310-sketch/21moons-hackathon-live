import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { updateSettings } from "@/lib/server/settings";
import { createTeam, registerTeam, updateTeam } from "@/lib/server/teams";
import { getPublicState, invalidatePublicCache } from "@/lib/server/state";
import { POST as register } from "@/app/api/team/register/route";
import { POST as teamLogin } from "@/app/api/team/login/route";
import { GET as teamMe } from "@/app/api/team/me/route";
import { GET as publicTeams } from "@/app/api/public/teams/route";
import { GET as adminState } from "@/app/api/admin/state/route";
import { POST as adminLogin } from "@/app/api/admin/login/route";
import { POST as adminAction } from "@/app/api/admin/action/route";
import { resetDb } from "./helpers";

beforeEach(resetDb);

let ipSeq = 0;
const req = (path: string, init: RequestInit & { cookie?: string; ip?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("host", "localhost");
  headers.set("x-forwarded-for", init.ip ?? `10.0.0.${++ipSeq % 250}`);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`http://localhost${path}`, { ...init, headers });
};
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const noCtx = { params: Promise.resolve({}) } as never;
const reg = (name: string, participants: string[], ip?: string) =>
  register(req("/api/team/register", { method: "POST", body: JSON.stringify({ name, participants }), ip }), noCtx);

describe("self-service team registration", () => {
  it("creates team + participants + codes, authenticates, and shows up on leaderboard and admin", async () => {
    const res = await reg("Nova Crew", ["Alice", "Bob", "Cara"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.team.name).toBe("Nova Crew");
    expect(body.accessCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(body.participants.map((p: { name: string }) => p.name)).toEqual(["Alice", "Bob", "Cara"]);
    for (const p of body.participants) expect(p.voteCode).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{4}$/);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/moons_team=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    // Immediately authenticated
    const me = await teamMe(req("/api/team/me", { cookie: cookieFrom(res) }), noCtx);
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.team.name).toBe("Nova Crew");
    expect(meBody.score).toBe(0);
    expect(meBody.members).toEqual(["Alice", "Bob", "Cara"]);

    // Codes are hashed exactly like admin-created teams
    const [sec] = await db()`select access_code_hash from team_secrets where team_id = ${body.team.id}`;
    expect(sec.access_code_hash.startsWith("scrypt$")).toBe(true);
    expect(sec.access_code_hash).not.toContain(body.accessCode.replace(/-/g, ""));
    const parts = await db()`select vote_code_hash from participants where team_id = ${body.team.id}`;
    expect(parts).toHaveLength(3);
    for (const p of parts) expect(p.vote_code_hash).toMatch(/^[0-9a-f]{64}$/);

    // The shared code works for teammates on other devices
    const login = await teamLogin(req("/api/team/login", { method: "POST", body: JSON.stringify({ teamId: body.team.id, code: body.accessCode }) }), noCtx);
    expect(login.status).toBe(200);

    // Leaderboard with 0 points
    invalidatePublicCache();
    const pub = await getPublicState({ fresh: true });
    expect(pub.leaderboard.find((r) => r.name === "Nova Crew")?.score).toBe(0);

    // Admin → Teams
    const admin = await adminLogin(req("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "test-admin-password" }) }), noCtx);
    const st = await (await adminState(req("/api/admin/state", { cookie: cookieFrom(admin) }), noCtx)).json();
    const t = st.teams.find((x: { name: string }) => x.name === "Nova Crew");
    expect(t).toMatchObject({ active: true, selfRegistered: true, score: 0 });
    expect(t.participants).toHaveLength(3);
    const [log] = await db()`select count(*)::int as n from admin_audit_log where action = 'team.self_registered'`;
    expect(log.n).toBe(1);
  });

  it("requires a team name and at least 2 participants", async () => {
    expect((await reg("Solo", ["Only Me"])).status).toBe(400);
    expect((await reg("Nobody", [])).status).toBe(400);
    expect((await reg("   ", ["A", "B"])).status).toBe(400);
    const [{ n }] = await db()`select count(*)::int as n from teams`;
    expect(n).toBe(0);
  });

  it("team names are unique (case-insensitive) against admin-created and self-created teams", async () => {
    await createTeam({ name: "Orbit AI", participants: ["X", "Y"] });
    const dup = await reg("orbit ai", ["A", "B"]);
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatch(/already exists/);
    expect((await reg("Nova", ["A", "B"])).status).toBe(200);
    expect((await reg("NOVA", ["C", "D"])).status).toBe(409);
    await expect(createTeam({ name: "nova", participants: ["E"] })).rejects.toThrow(/already exists/);
  });

  it("simultaneous registrations with the same name: exactly one wins (DB-enforced)", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => reg(i % 2 ? "Race Team" : "race team", [`P${i}a`, `P${i}b`])));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    const [{ n }] = await db()`select count(*)::int as n from teams where lower(name) = 'race team'`;
    expect(n).toBe(1);
    // Losers left no orphaned participants behind.
    const [{ p }] = await db()`select count(*)::int as p from participants`;
    expect(p).toBe(2);
  });

  it("the database itself rejects a duplicate active name", async () => {
    await createTeam({ name: "Apollo", participants: ["A"] });
    await expect(db()`insert into teams (name, slug) values ('APOLLO', 'apollo-dupe')`).rejects.toThrow(/teams_active_name_unique/);
  });

  it("when registration is closed: no new teams, /team says closed, existing teams can still log in", async () => {
    const existing = await createTeam({ name: "Existing", participants: ["A", "B"] });
    await updateSettings({ teamRegistrationOpen: false });
    const res = await reg("Latecomers", ["A", "B"]);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/closed/i);
    await expect(registerTeam({ name: "Direct", participants: ["A", "B"] }, "1.2.3.4")).rejects.toThrow(/closed/);
    const list = await (await publicTeams(req("/api/public/teams"), noCtx)).json();
    expect(list.registrationOpen).toBe(false);
    expect(list.teams.map((t: { name: string }) => t.name)).toEqual(["Existing"]);
    const login = await teamLogin(req("/api/team/login", { method: "POST", body: JSON.stringify({ teamId: existing.team.id, code: existing.accessCode }) }), noCtx);
    expect(login.status).toBe(200);
    await updateSettings({ teamRegistrationOpen: true });
    expect((await reg("Latecomers", ["A", "B"])).status).toBe(200);
  });

  it("admin can open/close registration via the action API and keeps full control of self-created teams", async () => {
    const admin = await adminLogin(req("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "test-admin-password" }) }), noCtx);
    const cookie = cookieFrom(admin);
    const close = await adminAction(req("/api/admin/action", { method: "POST", cookie, body: JSON.stringify({ action: "settings.update", teamRegistrationOpen: false }) }), noCtx);
    expect(close.status).toBe(200);
    expect((await reg("Blocked", ["A", "B"])).status).toBe(403);
    // Unauthenticated clients can't reopen it.
    const anon = await adminAction(req("/api/admin/action", { method: "POST", body: JSON.stringify({ action: "settings.update", teamRegistrationOpen: true }) }), noCtx);
    expect(anon.status).toBe(401);
    await adminAction(req("/api/admin/action", { method: "POST", cookie, body: JSON.stringify({ action: "settings.update", teamRegistrationOpen: true }) }), noCtx);
    const r = await reg("Self Made", ["A", "B"]);
    const body = await r.json();
    // Admin can rename and archive; archiving signs the team out.
    await updateTeam(body.team.id, { name: "Self Made Renamed" });
    await updateTeam(body.team.id, { active: false });
    expect((await teamMe(req("/api/team/me", { cookie: cookieFrom(r) }), noCtx)).status).toBe(401);
    // Name of an archived team can be reused; restoring into a clash is a clean 409, not a 500.
    await createTeam({ name: "Self Made Renamed", participants: ["Z"] });
    await expect(updateTeam(body.team.id, { active: true })).rejects.toThrow(/already uses that name/);
  });

  it("registration is throttled per IP", async () => {
    let last = 0;
    for (let i = 0; i < 26; i++) last = (await reg(`Spam ${i}`, ["A", "B"], "9.9.9.9")).status;
    expect(last).toBe(429);
  });
});
