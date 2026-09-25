import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { castVote, finalizePeoplesChoice, setVotingState, voterStatus } from "@/lib/server/voting";
import { submitApplication, createUploadSlot, storeLocalUpload } from "@/lib/server/submissions";
import { POST as adminAction } from "@/app/api/admin/action/route";
import { POST as adminLogin } from "@/app/api/admin/login/route";
import { GET as adminState } from "@/app/api/admin/state/route";
import { GET as evidenceGet } from "@/app/api/admin/evidence/[fileId]/route";
import { GET as publicState } from "@/app/api/public/state/route";
import { POST as teamLogin } from "@/app/api/team/login/route";
import { POST as teamSubmit } from "@/app/api/team/submissions/route";
import { GET as teamMe } from "@/app/api/team/me/route";
import { invalidatePublicCache } from "@/lib/server/state";
import { makeChallenge, makeTeam, resetDb, scoreOf } from "./helpers";

beforeEach(resetDb);

const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("host", "localhost");
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`http://localhost${path}`, { ...init, headers });
};
const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
const noCtx = { params: Promise.resolve({}) } as never;

describe("People's Choice", () => {
  it("8. a participant cannot vote for their own team (app + database)", async () => {
    const a = await makeTeam("Alpha", ["Ada"]);
    await makeTeam("Bravo", ["Ben"]);
    await setVotingState("open");
    await expect(castVote(a.participants[0].voteCode, a.team.id, "1.1.1.1")).rejects.toThrow(/own team/);
    // Even a direct insert is refused by the database trigger.
    await expect(db()`insert into votes (participant_id, voted_team_id) values (${a.participants[0].id}, ${a.team.id})`).rejects.toThrow(/own team/);
    const status = await voterStatus(a.participants[0].voteCode, "1.1.1.1");
    expect(status.teams.map((t) => t.name)).toEqual(["Bravo"]);
  });

  it("9. a participant cannot vote twice", async () => {
    const a = await makeTeam("Alpha", ["Ada"]);
    const b = await makeTeam("Bravo", ["Ben"]);
    const c = await makeTeam("Charlie", ["Cy"]);
    await setVotingState("open");
    await castVote(a.participants[0].voteCode, b.team.id, "1.1.1.1");
    await expect(castVote(a.participants[0].voteCode, c.team.id, "1.1.1.1")).rejects.toThrow(/already voted/);
    const [{ n }] = await db()`select count(*)::int as n from votes`;
    expect(n).toBe(1);
  });

  it("voting must be open; ties are surfaced, not silently resolved", async () => {
    const a = await makeTeam("Alpha", ["Ada", "Al"]);
    const b = await makeTeam("Bravo", ["Ben", "Bo"]);
    await expect(castVote(a.participants[0].voteCode, b.team.id, "1.1.1.1")).rejects.toThrow(/not open/);
    await setVotingState("open");
    await castVote(a.participants[0].voteCode, b.team.id, "1.1.1.1");
    await castVote(b.participants[0].voteCode, a.team.id, "1.1.1.1");
    await expect(finalizePeoplesChoice({})).rejects.toThrow(/Close voting/);
    await setVotingState("closed");
    const res = await finalizePeoplesChoice({});
    expect(res.tie).toBe(true);
    expect(await scoreOf(a.team.id)).toEqual({ ledger: 0, cached: 0 });
    const co = await finalizePeoplesChoice({ mode: "co_winners" });
    expect(co.tie).toBe(false);
    expect(await scoreOf(a.team.id)).toEqual({ ledger: 25, cached: 25 });
    expect(await scoreOf(b.team.id)).toEqual({ ledger: 25, cached: 25 });
    await expect(finalizePeoplesChoice({ mode: "co_winners" })).rejects.toThrow(/already finalized/);
    const [{ n }] = await db()`select count(*)::int as n from admin_audit_log where action = 'challenge.finalized'`;
    expect(n).toBe(1);
  });

  it("vote codes are not stored in plaintext", async () => {
    const a = await makeTeam("Alpha", ["Ada"]);
    const [p] = await db()`select vote_code_hash from participants where id = ${a.participants[0].id}`;
    expect(p.vote_code_hash).not.toContain(a.participants[0].voteCode.replace("-", ""));
    const [s] = await db()`select access_code_hash from team_secrets where team_id = ${a.team.id}`;
    expect(s.access_code_hash.startsWith("scrypt$")).toBe(true);
    expect(s.access_code_hash).not.toContain(a.accessCode!.replace(/-/g, ""));
  });
});

describe("authorization", () => {
  it("10. an unauthenticated client cannot approve an application", async () => {
    const { team } = await makeTeam("Alpha");
    const cid = await makeChallenge({ points: 20 });
    const s = await submitApplication(team.id, { challengeId: cid, description: "done it", evidenceUrl: "https://x.io" });
    const body = JSON.stringify({ action: "submission.approve", id: s.id });
    const res = await adminAction(req("/api/admin/action", { method: "POST", body }), noCtx);
    expect(res.status).toBe(401);
    // Forged cookie
    const forged = await adminAction(req("/api/admin/action", { method: "POST", body, cookie: "moons_admin=eyJyIjoiYWRtaW4ifQ.fake" }), noCtx);
    expect(forged.status).toBe(401);
    // A logged-in TEAM is still not an admin.
    const login = await teamLogin(req("/api/team/login", { method: "POST", body: JSON.stringify({ teamId: team.id, code: (await regenCode(team.id)) }) }), noCtx);
    const teamRes = await adminAction(req("/api/admin/action", { method: "POST", body, cookie: cookieFrom(login) }), noCtx);
    expect(teamRes.status).toBe(401);
    expect(await scoreOf(team.id)).toEqual({ ledger: 0, cached: 0 });
    expect((await adminState(req("/api/admin/state"), noCtx)).status).toBe(401);
  });

  it("admin login works with the right password and then can approve", async () => {
    const bad = await adminLogin(req("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "nope" }) }), noCtx);
    expect(bad.status).toBe(400);
    const ok = await adminLogin(req("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "test-admin-password" }) }), noCtx);
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    const { team } = await makeTeam("Alpha");
    const cid = await makeChallenge({ points: 20 });
    const s = await submitApplication(team.id, { challengeId: cid, description: "done it" });
    const res = await adminAction(req("/api/admin/action", { method: "POST", body: JSON.stringify({ action: "submission.approve", id: s.id }), cookie: cookieFrom(ok) }), noCtx);
    expect(res.status).toBe(200);
    expect(await scoreOf(team.id)).toEqual({ ledger: 20, cached: 20 });
  });

  it("cross-origin admin POSTs are blocked", async () => {
    const res = await adminAction(req("/api/admin/action", { method: "POST", body: "{}", headers: { origin: "https://evil.example" } }), noCtx);
    expect(res.status).toBe(403);
  });

  it("team identity comes from the session, never from the request body", async () => {
    const a = await makeTeam("Alpha");
    const b = await makeTeam("Bravo");
    const cid = await makeChallenge({ points: 20 });
    const code = await regenCode(a.team.id);
    const login = await teamLogin(req("/api/team/login", { method: "POST", body: JSON.stringify({ teamId: a.team.id, code }) }), noCtx);
    expect(login.status).toBe(200);
    const res = await teamSubmit(req("/api/team/submissions", {
      method: "POST", cookie: cookieFrom(login),
      body: JSON.stringify({ challengeId: cid, description: "trying to act as Bravo", teamId: b.team.id }),
    }), noCtx);
    expect(res.status).toBe(200);
    const rows = await db()`select team_id from challenge_submissions`;
    expect(rows.map((r) => r.team_id)).toEqual([a.team.id]);
    // No cookie → 401
    const anon = await teamSubmit(req("/api/team/submissions", { method: "POST", body: JSON.stringify({ challengeId: cid, description: "x" }) }), noCtx);
    expect(anon.status).toBe(401);
    // Wrong code → rejected
    const wrong = await teamLogin(req("/api/team/login", { method: "POST", body: JSON.stringify({ teamId: b.team.id, code: "AAAA-BBBB-CCCC" }) }), noCtx);
    expect(wrong.status).toBe(400);
  });

  it("regenerating a team code logs out existing sessions", async () => {
    const a = await makeTeam("Alpha");
    const code = await regenCode(a.team.id);
    const login = await teamLogin(req("/api/team/login", { method: "POST", body: JSON.stringify({ teamId: a.team.id, code }) }), noCtx);
    expect((await teamMe(req("/api/team/me", { cookie: cookieFrom(login) }), noCtx)).status).toBe(200);
    await regenCode(a.team.id);
    expect((await teamMe(req("/api/team/me", { cookie: cookieFrom(login) }), noCtx)).status).toBe(401);
  });
});

describe("no leakage", () => {
  it("14. public API never reveals secret / unrevealed challenges", async () => {
    await makeChallenge({ title: "t-future-secret", status: "scheduled", isSecret: true, revealAt: new Date(Date.now() + 3600_000).toISOString(), shortDescription: "SUPER-SECRET-TEXT" });
    await makeChallenge({ title: "t-draft", status: "draft", revealAt: null, fullDescription: "DRAFT-TEXT" });
    const res = await publicState(req("/api/public/state"), noCtx);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("SUPER-SECRET-TEXT");
    expect(text).not.toContain("t-future-secret");
    expect(text).not.toContain("DRAFT-TEXT");
    // The seeded secret challenge placeholder is not exposed either.
    expect(text).not.toContain("secret-challenge");
    // Team dashboard: same rule.
    const a = await makeTeam("Alpha");
    const code = await regenCode(a.team.id);
    const login = await teamLogin(req("/api/team/login", { method: "POST", body: JSON.stringify({ teamId: a.team.id, code }) }), noCtx);
    const me = await (await teamMe(req("/api/team/me", { cookie: cookieFrom(login) }), noCtx)).text();
    expect(me).not.toContain("SUPER-SECRET-TEXT");
    expect(me).not.toContain("DRAFT-TEXT");
    expect(me).not.toContain("access_code_hash");
    expect(me).not.toContain("vote_code_hash");
  });

  it("a secret challenge's reveal time is not advertised as the next drop", async () => {
    const at = new Date(Date.now() + 60_000);
    await makeChallenge({ title: "t-secret-soon", status: "scheduled", isSecret: true, revealAt: at.toISOString() });
    const body = await (await publicState(req("/api/public/state"), noCtx)).json();
    expect(body.nextDropAt === null || new Date(body.nextDropAt).getTime() > at.getTime()).toBe(true);
    await makeChallenge({ title: "t-public-soon", status: "scheduled", revealAt: at.toISOString() });
    invalidatePublicCache();
    const body2 = await (await publicState(req("/api/public/state"), noCtx)).json();
    expect(new Date(body2.nextDropAt).getTime()).toBe(at.getTime());
  });

  it("15. evidence cannot be browsed publicly", async () => {
    const a = await makeTeam("Alpha");
    const cid = await makeChallenge({ points: 20 });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const slot = await createUploadSlot(a.team.id, { name: "proof.png", mime: "image/png", size: png.byteLength });
    await storeLocalUpload(a.team.id, slot.fileId, png);
    await submitApplication(a.team.id, { challengeId: cid, description: "proof attached", fileIds: [slot.fileId] });
    const ctx = { params: Promise.resolve({ fileId: slot.fileId }) } as never;
    // No admin session → 401
    expect((await evidenceGet(req(`/api/admin/evidence/${slot.fileId}`), ctx)).status).toBe(401);
    // Team session → still 401
    const code = await regenCode(a.team.id);
    const login = await teamLogin(req("/api/team/login", { method: "POST", body: JSON.stringify({ teamId: a.team.id, code }) }), noCtx);
    expect((await evidenceGet(req(`/api/admin/evidence/${slot.fileId}`, { cookie: cookieFrom(login) }), ctx)).status).toBe(401);
    // Admin → 200
    const ok = await adminLogin(req("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "test-admin-password" }) }), noCtx);
    const adminRes = await evidenceGet(req(`/api/admin/evidence/${slot.fileId}`, { cookie: cookieFrom(ok) }), ctx);
    expect(adminRes.status).toBe(200);
    expect(adminRes.headers.get("content-type")).toBe("image/png");
    // Public API payloads never contain storage paths.
    const pub = await (await publicState(req("/api/public/state"), noCtx)).text();
    expect(pub).not.toContain(slot.fileId);
    // Supabase Data API roles (anon/authenticated) can't read evidence or secrets.
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["submission_files", "challenge_submissions", "team_secrets", "participants", "local_evidence_objects", "challenges", "score_ledger"]) {
        await expect(db().begin(async (tx) => { await tx.unsafe(`set local role ${role}`); return tx.unsafe(`select * from ${table}`); }))
          .rejects.toThrow(/permission denied/);
      }
    }
    // The only table the API roles can see is the data-free realtime signal.
    const sig = await db().begin(async (tx) => { await tx.unsafe("set local role anon"); return tx.unsafe("select * from live_signals"); });
    expect(Object.keys(sig[0]).sort()).toEqual(["channel", "updated_at", "version"]);
  });

  it("uploads with a spoofed type are rejected", async () => {
    const a = await makeTeam("Alpha");
    const cid = await makeChallenge({ points: 20 });
    await expect(createUploadSlot(a.team.id, { name: "x.exe", mime: "application/x-msdownload", size: 10 })).rejects.toThrow(/Only JPEG/);
    await expect(createUploadSlot(a.team.id, { name: "big.png", mime: "image/png", size: 9 * 1024 * 1024 })).rejects.toThrow(/8 MB/);
    const slot = await createUploadSlot(a.team.id, { name: "fake.png", mime: "image/png", size: 5 });
    await storeLocalUpload(a.team.id, slot.fileId, new TextEncoder().encode("MZ..."));
    await expect(submitApplication(a.team.id, { challengeId: cid, description: "fake file", fileIds: [slot.fileId] })).rejects.toThrow(/not a valid/);
  });
});

async function regenCode(teamId: string): Promise<string> {
  const { regenerateTeamCode } = await import("@/lib/server/teams");
  return (await regenerateTeamCode(teamId)).accessCode;
}
