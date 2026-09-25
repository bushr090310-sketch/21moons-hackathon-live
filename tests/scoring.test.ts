import { beforeEach, describe, expect, it } from "vitest";
import { db, withTx } from "@/lib/server/db";
import { approveSubmission, rejectSubmission, revokeApproval, submitApplication } from "@/lib/server/submissions";
import { finalizeChallengeTx } from "@/lib/server/challenges";
import { manualAdjustment, reverseLedgerEntry } from "@/lib/server/scoring";
import { freezeLeaderboard, revealLeaderboard } from "@/lib/server/settings";
import { getPublicState } from "@/lib/server/state";
import { ledgerCount, makeChallenge, makeTeam, resetDb, scoreOf } from "./helpers";

const submit = (teamId: string, challengeId: string, extra: Record<string, unknown> = {}) =>
  submitApplication(teamId, { challengeId, description: "We did the thing, see link", evidenceUrl: "https://example.com", ...extra });

beforeEach(resetDb);

describe("OPEN_ONCE", () => {
  it("1. cannot award twice to the same team", async () => {
    const { team } = await makeTeam("Lunar");
    const cid = await makeChallenge({ type: "OPEN_ONCE", points: 15 });
    const s1 = await submit(team.id, cid);
    await approveSubmission(s1.id);
    // A second application is refused outright…
    await expect(submit(team.id, cid)).rejects.toThrow(/already completed/);
    // …and even a row inserted behind the API's back cannot be approved.
    const [rogue] = await db()`insert into challenge_submissions (challenge_id, team_id, description) values (${cid}, ${team.id}, 'sneaky') returning id`;
    await expect(approveSubmission(rogue.id)).rejects.toThrow(/already been awarded/);
    expect(await scoreOf(team.id)).toEqual({ ledger: 15, cached: 15 });
  });

  it("blocks a duplicate pending application", async () => {
    const { team } = await makeTeam("Dupe");
    const cid = await makeChallenge();
    await submit(team.id, cid);
    await expect(submit(team.id, cid)).rejects.toThrow(/pending application/);
  });
});

describe("FIRST_GLOBAL fairness", () => {
  it("2. B cannot be awarded before A (who applied first) is resolved", async () => {
    const a = (await makeTeam("Alpha")).team;
    const b = (await makeTeam("Bravo")).team;
    const cid = await makeChallenge({ type: "FIRST_GLOBAL", points: 20 });
    const sa = await submit(a.id, cid);
    const sb = await submit(b.id, cid);
    await expect(approveSubmission(sb.id)).rejects.toThrow(/Alpha applied earlier/);
    expect(await ledgerCount(b.id)).toBe(0);
    // Submitting does NOT lock the challenge.
    const c = (await makeTeam("Charlie")).team;
    await expect(submit(c.id, cid)).resolves.toBeTruthy();
    void sa;
  });

  it("3. rejecting A lets B be awarded", async () => {
    const a = (await makeTeam("Alpha")).team;
    const b = (await makeTeam("Bravo")).team;
    const cid = await makeChallenge({ type: "FIRST_GLOBAL", points: 20 });
    const sa = await submit(a.id, cid);
    const sb = await submit(b.id, cid);
    await rejectSubmission(sa.id, "Product was not publicly accessible");
    const res = await approveSubmission(sb.id);
    expect(res.awarded).toBe(20);
    expect(await scoreOf(b.id)).toEqual({ ledger: 20, cached: 20 });
    expect(await scoreOf(a.id)).toEqual({ ledger: 0, cached: 0 });
  });

  it("4. locks after a winner is approved; others are auto-rejected and new submissions blocked", async () => {
    const a = (await makeTeam("Alpha")).team;
    const b = (await makeTeam("Bravo")).team;
    const c = (await makeTeam("Charlie")).team;
    const cid = await makeChallenge({ type: "FIRST_GLOBAL", points: 25 });
    const sa = await submit(a.id, cid);
    const sb = await submit(b.id, cid);
    await approveSubmission(sa.id);
    const [bRow] = await db()`select status, review_note from challenge_submissions where id = ${sb.id}`;
    expect(bRow.status).toBe("rejected");
    expect(bRow.review_note).toMatch(/Claimed first by Alpha/);
    await expect(submit(c.id, cid)).rejects.toThrow(/already claimed by Alpha/);
    const pub = await getPublicState({ fresh: true });
    const ch = pub.challenges.find((x) => x.id === cid)!;
    expect(ch.state).toBe("claimed");
    expect(ch.claimedBy).toBe("Alpha");
  });

  it("concurrent approvals of the same FIRST challenge award exactly one team", async () => {
    const a = (await makeTeam("Alpha")).team;
    const b = (await makeTeam("Bravo")).team;
    const cid = await makeChallenge({ type: "FIRST_GLOBAL", points: 20 });
    const sa = await submit(a.id, cid);
    const sb = await submit(b.id, cid);
    const results = await Promise.allSettled([approveSubmission(sa.id), approveSubmission(sb.id), approveSubmission(sa.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [{ n }] = await db()`select count(*)::int as n from score_ledger where challenge_id = ${cid}`;
    expect(n).toBe(1);
  });

  it("revoking the winner reopens the challenge via a compensating entry", async () => {
    const a = (await makeTeam("Alpha")).team;
    const cid = await makeChallenge({ type: "FIRST_GLOBAL", points: 20 });
    const sa = await submit(a.id, cid);
    await approveSubmission(sa.id);
    await revokeApproval(sa.id, "Payment turned out to be internal");
    expect(await scoreOf(a.id)).toEqual({ ledger: 0, cached: 0 });
    expect(await ledgerCount(a.id)).toBe(2);
    const b = (await makeTeam("Bravo")).team;
    await expect(submit(b.id, cid)).resolves.toBeTruthy();
  });
});

describe("REPEATABLE", () => {
  it("5. respects the per-team cap", async () => {
    const { team } = await makeTeam("Rush");
    const cid = await makeChallenge({ type: "REPEATABLE", points: 15, maxCompletions: 2 });
    await approveSubmission((await submit(team.id, cid)).id);
    await approveSubmission((await submit(team.id, cid)).id);
    await expect(submit(team.id, cid)).rejects.toThrow(/maximum of 2/);
    expect(await scoreOf(team.id)).toEqual({ ledger: 30, cached: 30 });
  });

  it("multi-unit approval cannot exceed the cap", async () => {
    const { team } = await makeTeam("Rush2");
    const cid = await makeChallenge({ type: "REPEATABLE", points: 15, maxCompletions: 2 });
    const s = await submit(team.id, cid);
    await expect(approveSubmission(s.id, { units: 3 })).rejects.toThrow(/Only 2 award/);
    await approveSubmission(s.id, { units: 2 });
    expect(await scoreOf(team.id)).toEqual({ ledger: 30, cached: 30 });
    await expect(submit(team.id, cid)).rejects.toThrow(/maximum/);
  });
});

describe("challenge state enforcement (server-side)", () => {
  it("6. cannot submit to an expired challenge", async () => {
    const { team } = await makeTeam("Late");
    const cid = await makeChallenge({ revealAt: new Date(Date.now() - 3600_000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() });
    await expect(submit(team.id, cid)).rejects.toThrow(/expired/);
  });

  it("7. cannot submit to a locked challenge", async () => {
    const { team } = await makeTeam("Locked");
    const cid = await makeChallenge({ status: "locked" });
    await expect(submit(team.id, cid)).rejects.toThrow(/locked/);
  });

  it("cannot submit to an unrevealed (scheduled / draft) challenge", async () => {
    const { team } = await makeTeam("Early");
    const future = await makeChallenge({ status: "scheduled", revealAt: new Date(Date.now() + 3600_000).toISOString() });
    const draft = await makeChallenge({ status: "draft", revealAt: null });
    await expect(submit(team.id, future)).rejects.toThrow(/not found/);
    await expect(submit(team.id, draft)).rejects.toThrow(/not found/);
  });

  it("rejects non-http evidence URLs", async () => {
    const { team } = await makeTeam("Url");
    const cid = await makeChallenge();
    await expect(submit(team.id, cid, { evidenceUrl: "javascript:alert(1)" })).rejects.toThrow(/http/);
  });
});

describe("ledger", () => {
  it("11. approving a standard submission creates exactly one ledger entry, even if approved twice", async () => {
    const { team } = await makeTeam("Once");
    const cid = await makeChallenge({ points: 10 });
    const s = await submit(team.id, cid);
    await approveSubmission(s.id);
    await expect(approveSubmission(s.id)).rejects.toThrow(/already approved/);
    expect(await ledgerCount(team.id)).toBe(1);
    const [l] = await db()`select points_delta, entry_type, submission_id from score_ledger where team_id = ${team.id}`;
    expect(l).toMatchObject({ points_delta: 10, entry_type: "challenge_award", submission_id: s.id });
  });

  it("12. competitive / judged approval does not award winner points; finalization does, once", async () => {
    const a = (await makeTeam("Alpha")).team;
    const b = (await makeTeam("Bravo")).team;
    const comp = await makeChallenge({ type: "COMPETITIVE", points: 40 });
    const sa = await submit(a.id, comp, { numericValue: 1200 });
    const res = await approveSubmission(sa.id);
    expect(res.eligibleOnly).toBe(true);
    expect(await ledgerCount(a.id)).toBe(0);
    // A team without an approved entry can't win a competitive challenge.
    await expect(finalizeChallengeTx({ challengeId: comp, winnerTeamIds: [b.id] })).rejects.toThrow(/approved/);
    await finalizeChallengeTx({ challengeId: comp, winnerTeamIds: [a.id] });
    expect(await scoreOf(a.id)).toEqual({ ledger: 40, cached: 40 });
    await expect(finalizeChallengeTx({ challengeId: comp, winnerTeamIds: [a.id] })).rejects.toThrow(/already finalized/);

    const judged = await makeChallenge({ type: "JUDGED", points: 30, acceptsSubmissions: false });
    await expect(submit(b.id, judged)).rejects.toThrow(/jury|doesn't take/);
    await finalizeChallengeTx({ challengeId: judged, winnerTeamIds: [b.id] });
    expect(await scoreOf(b.id)).toEqual({ ledger: 30, cached: 30 });
  });

  it("13. manual correction is a ledger transaction; history is immutable", async () => {
    const { team } = await makeTeam("Fix");
    const cid = await makeChallenge({ points: 20 });
    await approveSubmission((await submit(team.id, cid)).id);
    await withTx((tx) => manualAdjustment(tx, { teamId: team.id, delta: -15, reason: "Duplicate evidence" }));
    expect(await scoreOf(team.id)).toEqual({ ledger: 5, cached: 5 });
    const rows = await db()`select points_delta, entry_type, reason from score_ledger where team_id = ${team.id} order by id`;
    expect(rows.map((r) => r.entry_type)).toEqual(["challenge_award", "manual_adjustment"]);
    await expect(withTx((tx) => manualAdjustment(tx, { teamId: team.id, delta: 5, reason: "" }))).rejects.toThrow(/reason/);
    // Ledger rows cannot be edited or deleted.
    await expect(db()`update score_ledger set points_delta = 999 where team_id = ${team.id}`).rejects.toThrow(/append-only/);
    await expect(db()`delete from score_ledger where team_id = ${team.id}`).rejects.toThrow(/append-only/);
    // Undo via compensating transaction.
    const [adj] = await db()`select id from score_ledger where entry_type = 'manual_adjustment' and team_id = ${team.id}`;
    await withTx((tx) => reverseLedgerEntry(tx, Number(adj.id), "Mistake"));
    expect(await scoreOf(team.id)).toEqual({ ledger: 20, cached: 20 });
    await expect(withTx((tx) => reverseLedgerEntry(tx, Number(adj.id), "again"))).rejects.toThrow(/already been reversed/);
  });

  it("changing nominal points later does not rewrite past awards", async () => {
    const { team } = await makeTeam("Hist");
    const cid = await makeChallenge({ points: 20 });
    await approveSubmission((await submit(team.id, cid)).id);
    await db()`update challenges set points = 50 where id = ${cid}`;
    expect(await scoreOf(team.id)).toEqual({ ledger: 20, cached: 20 });
  });
});

describe("leaderboard freeze", () => {
  it("public board stops at freeze time while real points keep accruing; reveal shows the truth", async () => {
    const a = (await makeTeam("Alpha")).team;
    const b = (await makeTeam("Bravo")).team;
    const c1 = await makeChallenge({ points: 10 });
    const c2 = await makeChallenge({ points: 50 });
    await approveSubmission((await submit(a.id, c1)).id);
    await freezeLeaderboard();
    await new Promise((r) => setTimeout(r, 20));
    await approveSubmission((await submit(b.id, c2)).id);
    const frozen = await getPublicState({ fresh: true });
    expect(frozen.event.frozen).toBe(true);
    expect(frozen.leaderboard[0]).toMatchObject({ name: "Alpha", score: 10 });
    expect(frozen.leaderboard.find((r) => r.name === "Bravo")!.score).toBe(0);
    expect(frozen.activity.some((x) => x.teamName === "Bravo")).toBe(false);
    expect(await scoreOf(b.id)).toEqual({ ledger: 50, cached: 50 });
    await revealLeaderboard();
    const after = await getPublicState({ fresh: true });
    expect(after.leaderboard[0]).toMatchObject({ name: "Bravo", score: 50 });
    expect(after.event.revealedAt).not.toBeNull();
  });

  it("ties keep equal scores and order by who reached the score first", async () => {
    const a = (await makeTeam("Zulu")).team;
    const b = (await makeTeam("Alpha")).team;
    const cid = await makeChallenge({ points: 10 });
    await approveSubmission((await submit(a.id, cid)).id);
    await new Promise((r) => setTimeout(r, 20));
    await approveSubmission((await submit(b.id, cid)).id);
    const pub = await getPublicState({ fresh: true });
    expect(pub.leaderboard.map((r) => [r.name, r.score])).toEqual([["Zulu", 10], ["Alpha", 10]]);
  });
});
