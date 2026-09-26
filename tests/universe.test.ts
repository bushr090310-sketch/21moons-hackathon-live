import { beforeEach, describe, expect, it } from "vitest";
import { db, withTx } from "@/lib/server/db";
import { approveSubmission, submitApplication } from "@/lib/server/submissions";
import { manualAdjustment } from "@/lib/server/scoring";
import { freezeLeaderboard } from "@/lib/server/settings";
import { castVote, setVotingState } from "@/lib/server/voting";
import { invalidatePublicCache, getPublicState } from "@/lib/server/state";
import { adminGrantPower, grantPower, reconcileRewards, revokePower, setChallengeReward, usePower } from "@/lib/server/universe/powers";
import { goLive, endEvent, createDraft } from "@/lib/server/universe/cosmic";
import { competitionNews, runTick, suggestCosmicEvents } from "@/lib/server/universe/tick";
import { archiveNews, getUniversePublic, getUniverseTeam, publishBroadcast, updateUniverseSettings } from "@/lib/server/universe/state";
import { buildTakeoverQueue, cosmicPhase, deriveStatuses, attackDelta } from "@/lib/shared/universe";
import { POST as usePowerRoute } from "@/app/api/universe/powers/use/route";
import { GET as universePublicRoute } from "@/app/api/universe/public/route";
import { POST as universeAdminRoute } from "@/app/api/admin/universe/route";
import { POST as teamLogin } from "@/app/api/team/login/route";
import { POST as register } from "@/app/api/team/register/route";
import { makeChallenge, makeTeam, resetDb, scoreOf } from "./helpers";

beforeEach(async () => {
  await resetDb();
});

const on = () => updateUniverseSettings({ enabled: true });
let rid = 0;
const req = () => `req-${Date.now()}-${++rid}-abcdef`;

async function giveScore(teamId: string, pts: number) {
  await withTx((tx) => manualAdjustment(tx, { teamId, delta: pts, reason: "test setup" }));
}
async function ledger(teamId: string) {
  return db()`select points_delta, entry_type, reason, public_label, award_key from score_ledger where team_id = ${teamId} order by id`;
}

describe("☄️ Cosmic powers", () => {
  it("1+2. Meteor Strike consumes exactly one token and writes one −5 ledger entry", async () => {
    await on();
    const a = (await makeTeam("Lunar Labs")).team;
    const b = (await makeTeam("Rocket Scientists")).team;
    await giveScore(b.id, 50);
    const p1 = await adminGrantPower(a.id, "SABOTAGE_5");
    const p2 = await adminGrantPower(a.id, "SABOTAGE_5");
    const res = await usePower(a.id, { powerupId: p1!, targetTeamId: b.id, requestId: req() });
    expect(res).toMatchObject({ blocked: false, appliedDelta: -5 });
    expect(await scoreOf(b.id)).toEqual({ ledger: 45, cached: 45 });
    const l = await ledger(b.id);
    expect(l).toHaveLength(2);
    expect(l[1]).toMatchObject({ points_delta: -5, entry_type: "manual_adjustment", public_label: "☄️ Meteor Strike by Lunar Labs", award_key: `power:${p1}` });
    const powers = await db()`select id, status from team_powerups where team_id = ${a.id} order by earned_at, id`;
    const byId = Object.fromEntries(powers.map((p) => [p.id, p.status]));
    expect(byId[p1!]).toBe("used");
    expect(byId[p2!]).toBe("available");
    expect(await scoreOf(a.id)).toEqual({ ledger: 0, cached: 0 });
  });

  it("3. Moonstrike removes 10 pts", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const b = (await makeTeam("B")).team;
    await giveScore(b.id, 30);
    const p = await adminGrantPower(a.id, "SABOTAGE_10");
    const r = await usePower(a.id, { powerupId: p!, targetTeamId: b.id, requestId: req() });
    expect(r.appliedDelta).toBe(-10);
    expect(await scoreOf(b.id)).toEqual({ ledger: 20, cached: 20 });
  });

  it("4. cannot attack own team, archived teams, or with someone else's power", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const b = (await makeTeam("B")).team;
    const c = (await makeTeam("C")).team;
    await giveScore(a.id, 30);
    await giveScore(c.id, 30);
    const p = await adminGrantPower(a.id, "SABOTAGE_5");
    await expect(usePower(a.id, { powerupId: p!, targetTeamId: a.id, requestId: req() })).rejects.toThrow(/own Moon/);
    await expect(usePower(b.id, { powerupId: p!, targetTeamId: c.id, requestId: req() })).rejects.toThrow(/not found/i);
    await db()`update teams set active = false where id = ${c.id}`;
    await expect(usePower(a.id, { powerupId: p!, targetTeamId: c.id, requestId: req() })).rejects.toThrow(/can't be targeted/);
    const [row] = await db()`select status from team_powerups where id = ${p}`;
    expect(row.status).toBe("available");
  });

  it("5. an attack never pushes a score below 0 (6 pts − Moonstrike = −6)", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const b = (await makeTeam("B")).team;
    await giveScore(b.id, 6);
    const p = await adminGrantPower(a.id, "SABOTAGE_10");
    const r = await usePower(a.id, { powerupId: p!, targetTeamId: b.id, requestId: req() });
    expect(r.appliedDelta).toBe(-6);
    expect(await scoreOf(b.id)).toEqual({ ledger: 0, cached: 0 });
    // A target at 0 can't be hit, and the power is NOT consumed.
    const p2 = await adminGrantPower(a.id, "SABOTAGE_5");
    await expect(usePower(a.id, { powerupId: p2!, targetTeamId: b.id, requestId: req() })).rejects.toThrow(/0 pts/);
    const [row] = await db()`select status from team_powerups where id = ${p2}`;
    expect(row.status).toBe("available");
    expect(attackDelta(10, 6)).toBe(6);
    expect(attackDelta(5, -3)).toBe(0);
  });

  it("6. replay cannot reuse a token (same request, new request, concurrent double-click)", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const b = (await makeTeam("B")).team;
    await giveScore(b.id, 100);
    const p = await adminGrantPower(a.id, "SABOTAGE_5");
    const r1 = req();
    const [x, y] = await Promise.allSettled([
      usePower(a.id, { powerupId: p!, targetTeamId: b.id, requestId: r1 }),
      usePower(a.id, { powerupId: p!, targetTeamId: b.id, requestId: req() }),
    ]);
    expect([x, y].filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const again = await usePower(a.id, { powerupId: p!, targetTeamId: b.id, requestId: r1 }).catch((e) => e);
    // Either the idempotent replay of the winning request, or a clean "already used".
    if (again instanceof Error) expect(again.message).toMatch(/already been used/);
    else expect(again.replay).toBe(true);
    await expect(usePower(a.id, { powerupId: p!, targetTeamId: b.id, requestId: req() })).rejects.toThrow(/already been used/);
    expect(await scoreOf(b.id)).toEqual({ ledger: 95, cached: 95 });
    const [{ n }] = await db()`select count(*)::int as n from power_attacks`;
    expect(n).toBe(1);
  });

  it("7+8+9. Force Field blocks the attack, both powers are consumed, no negative ledger entry", async () => {
    await on();
    const a = (await makeTeam("Lunar Labs")).team;
    const b = (await makeTeam("Rocket Scientists")).team;
    await giveScore(b.id, 40);
    const shield = await adminGrantPower(b.id, "SHIELD");
    const p = await adminGrantPower(a.id, "SABOTAGE_10");
    const r = await usePower(a.id, { powerupId: p!, targetTeamId: b.id, requestId: req() });
    expect(r).toMatchObject({ blocked: true, appliedDelta: 0 });
    expect(await scoreOf(b.id)).toEqual({ ledger: 40, cached: 40 });
    expect(await ledger(b.id)).toHaveLength(1);
    const st = await db()`select id, status from team_powerups`;
    expect(st.find((x) => x.id === shield)!.status).toBe("used");
    expect(st.find((x) => x.id === p)!.status).toBe("used");
    const [ev] = await db()`select event_type, takeover from live_events where event_type = 'ATTACK_BLOCKED'`;
    expect(ev).toMatchObject({ event_type: "ATTACK_BLOCKED", takeover: true });
    // One shield blocks one attack: the next one lands.
    const p2 = await adminGrantPower(a.id, "SABOTAGE_5");
    const r2 = await usePower(a.id, { powerupId: p2!, targetTeamId: b.id, requestId: req() });
    expect(r2.blocked).toBe(false);
    expect(await scoreOf(b.id)).toEqual({ ledger: 35, cached: 35 });
    await expect(usePower(a.id, { powerupId: shield!, targetTeamId: b.id, requestId: req() })).rejects.toThrow(/not found/i);
  });

  it("powers are rate limited, paused while frozen, and the endpoint needs a team session", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const b = (await makeTeam("B")).team;
    await giveScore(b.id, 100);
    const ids = [await adminGrantPower(a.id, "SABOTAGE_5"), await adminGrantPower(a.id, "SABOTAGE_5"), await adminGrantPower(a.id, "SABOTAGE_5")];
    await usePower(a.id, { powerupId: ids[0]!, targetTeamId: b.id, requestId: req() });
    await usePower(a.id, { powerupId: ids[1]!, targetTeamId: b.id, requestId: req() });
    await expect(usePower(a.id, { powerupId: ids[2]!, targetTeamId: b.id, requestId: req() })).rejects.toThrow(/wait a minute/);
    const anon = await usePowerRoute(new Request("http://localhost/api/universe/powers/use", {
      method: "POST", headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ powerupId: ids[2], targetTeamId: b.id, requestId: req() }),
    }), { params: Promise.resolve({}) } as never);
    expect(anon.status).toBe(401);
    await freezeLeaderboard();
    await db()`delete from power_attacks`; // clear the rate window (test-only table)
    await expect(usePower(a.id, { powerupId: ids[2]!, targetTeamId: b.id, requestId: req() })).rejects.toThrow(/frozen/);
  });

  it("powers only work when the universe is switched on", async () => {
    const a = (await makeTeam("A")).team;
    await expect(adminGrantPower(a.id, "SHIELD")).rejects.toThrow(/switched off/);
  });

  it("challenge rewards grant powers on approval — only for approvals after the reward was attached", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const b = (await makeTeam("B")).team;
    const cid = await makeChallenge({ title: "t-steal-the-moon", points: 10 });
    const sa = await submitApplication(a.id, { challengeId: cid, description: "done before reward" });
    await approveSubmission(sa.id);
    await setChallengeReward(cid, "SABOTAGE_10");
    const sb = await submitApplication(b.id, { challengeId: cid, description: "done after reward" });
    await approveSubmission(sb.id);
    const r = await withTx((tx) => reconcileRewards(tx));
    expect(r.granted).toBe(1);
    const again = await withTx((tx) => reconcileRewards(tx));
    expect(again.granted).toBe(0);
    const owned = await db()`select team_id, powerup_type, source from team_powerups`;
    expect(owned).toEqual([{ team_id: b.id, powerup_type: "SABOTAGE_10", source: "challenge" }]);
    // Scoring of the challenge itself is unchanged: +10 each.
    expect((await scoreOf(a.id)).ledger).toBe(10);
    expect((await scoreOf(b.id)).ledger).toBe(10);
  });

  it("admin can revoke only UNUSED powers", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const b = (await makeTeam("B")).team;
    await giveScore(b.id, 20);
    const p = await adminGrantPower(a.id, "SABOTAGE_5");
    const q = await adminGrantPower(a.id, "SABOTAGE_5");
    await revokePower(q!, "granted by mistake");
    await usePower(a.id, { powerupId: p!, targetTeamId: b.id, requestId: req() });
    await expect(revokePower(p!, "too late")).rejects.toThrow(/unused/);
    await expect(usePower(a.id, { powerupId: q!, targetTeamId: b.id, requestId: req() })).rejects.toThrow(/already been used/);
  });

  it("demo purge still works when demo teams have powers and attacks", async () => {
    await on();
    const { seedDemoTeams, removeDemoTeams } = await import("@/lib/server/teams");
    const cards = await seedDemoTeams();
    const [x, y] = cards.map((c) => c.team.id);
    await giveScore(y, 20);
    const p = await adminGrantPower(x, "SABOTAGE_5");
    await usePower(x, { powerupId: p!, targetTeamId: y, requestId: req() });
    const res = await removeDemoTeams();
    expect(res.removed).toBe(3);
  });
});

describe("📡 Lunar Network", () => {
  it("10. deduplicates and baselines (no flood of history when switched on)", async () => {
    const a = (await makeTeam("Apollo")).team;
    const b = (await makeTeam("Orbit")).team;
    await giveScore(a.id, 50);
    await on();
    await withTx((tx) => competitionNews(tx)); // baseline only
    expect((await db()`select count(*)::int as n from live_events`)[0].n).toBe(0);
    await giveScore(b.id, 60); // Orbit takes the lead
    await withTx((tx) => competitionNews(tx));
    await withTx((tx) => competitionNews(tx));
    await withTx((tx) => competitionNews(tx));
    const leaders = await db()`select headline, takeover from live_events where event_type = 'NEW_LEADER'`;
    expect(leaders).toHaveLength(1);
    expect(leaders[0].headline).toMatch(/ORBIT HAVE TAKEN THE LEAD/);
    expect(leaders[0].takeover).toBe(true);
    const close = await db()`select headline from live_events where event_type = 'CLOSE_RACE'`;
    expect(close).toHaveLength(0); // gap is 10
    await giveScore(a.id, 8); // gap 2 → close race, announced once
    await withTx((tx) => competitionNews(tx));
    await withTx((tx) => competitionNews(tx));
    const close2 = await db()`select headline from live_events where event_type = 'CLOSE_RACE'`;
    expect(close2).toHaveLength(1);
    expect(close2[0].headline).toMatch(/ONLY 2 PTS/);
  });

  it("announces sales signals and FIRST claims from real approvals", async () => {
    const a = (await makeTeam("Orbit")).team;
    await on();
    await withTx((tx) => competitionNews(tx));
    const sale = await db()`select id from challenges where slug = 'first-sale'`;
    await db()`update challenges set status = 'live', reveal_at = now() - interval '1 minute' where id = ${sale[0].id}`;
    const s = await submitApplication(a.id, { challengeId: sale[0].id, description: "stripe receipt attached" });
    await approveSubmission(s.id);
    await withTx((tx) => competitionNews(tx));
    const sig = await db()`select headline from live_events where event_type = 'SIGNAL'`;
    expect(sig[0].headline).toBe("SIGNAL RECEIVED — ORBIT JUST LANDED A REAL CUSTOMER");
    await db()`update challenges set status = 'scheduled', reveal_at = '2026-09-26 09:00 Europe/Stockholm' where id = ${sale[0].id}`;
  });

  it("stays silent about scores while the leaderboard is frozen", async () => {
    const a = (await makeTeam("A")).team;
    await on();
    await withTx((tx) => competitionNews(tx));
    await freezeLeaderboard();
    await giveScore(a.id, 99);
    await withTx((tx) => competitionNews(tx));
    expect((await db()`select count(*)::int as n from live_events`)[0].n).toBe(0);
  });

  it("11. manual breaking news enters the feed and can be archived without touching competition data", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    await giveScore(a.id, 10);
    const { id } = await publishBroadcast({ headline: "Supply drop — food has arrived", body: "2nd floor", importance: "breaking", emoji: "🍕" });
    const pub = await getUniversePublic({ fresh: true });
    expect(pub.enabled).toBe(true);
    expect(pub.feed[0]).toMatchObject({ headline: "SUPPLY DROP — FOOD HAS ARRIVED", importance: "breaking", source: "admin", takeover: true, emoji: "🍕" });
    expect(pub.takeovers.map((t) => t.id)).toContain(String(id));
    const before = await db()`select count(*)::int as n, coalesce(sum(points_delta),0)::int as s from score_ledger`;
    await archiveNews(id!);
    const after = await db()`select count(*)::int as n, coalesce(sum(points_delta),0)::int as s from score_ledger`;
    expect(after).toEqual(before);
    expect((await getUniversePublic({ fresh: true })).feed.find((f) => f.id === String(id))).toBeUndefined();
  });

  it("public universe API reports disabled when switched off and never errors", async () => {
    const res = await universePublicRoute();
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
  });
});

describe("🌕 Cosmic status", () => {
  it("12. derivation is deterministic and prioritised", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const st = deriveStatuses([
      { teamId: "a", rank: 1, score: 145, gainedLastHour: 60, rankThirtyMinAgo: 1, lastScoredAt: "2026-09-26T11:55:00Z" },
      { teamId: "b", rank: 2, score: 135, gainedLastHour: 40, rankThirtyMinAgo: 2, lastScoredAt: "2026-09-26T11:50:00Z" },
      { teamId: "c", rank: 3, score: 125, gainedLastHour: 0, rankThirtyMinAgo: 6, lastScoredAt: "2026-09-26T11:40:00Z" },
      { teamId: "d", rank: 4, score: 120, gainedLastHour: 0, rankThirtyMinAgo: 4, lastScoredAt: "2026-09-26T11:50:00Z" },
      { teamId: "e", rank: 5, score: 50, gainedLastHour: 0, rankThirtyMinAgo: 5, lastScoredAt: "2026-09-26T10:00:00Z" },
      { teamId: "f", rank: 6, score: 0, gainedLastHour: 0, rankThirtyMinAgo: 6, lastScoredAt: null },
      { teamId: "g", rank: 7, score: 10, gainedLastHour: 0, rankThirtyMinAgo: 7, lastScoredAt: "2026-09-26T11:59:00Z" },
    ], now, "d");
    expect(st.a.code).toBe("FULL_MOON");
    expect(st.b.code).toBe("SUPERNOVA");
    expect(st.b.detail).toBe("+40 pts in the last hour");
    expect(st.c.code).toBe("LIFTOFF");
    expect(st.d.code).toBe("ONE_TO_WATCH");
    expect(st.e.code).toBe("DARK_SIDE");
    expect(st.f).toBeUndefined();
    expect(st.g).toBeUndefined();
    const orbit = deriveStatuses([
      { teamId: "a", rank: 1, score: 100, gainedLastHour: 0, rankThirtyMinAgo: 1, lastScoredAt: "2026-09-26T11:59:00Z" },
      { teamId: "b", rank: 2, score: 90, gainedLastHour: 0, rankThirtyMinAgo: 2, lastScoredAt: "2026-09-26T11:59:00Z" },
    ], now, null);
    expect(orbit.b).toMatchObject({ code: "IN_ORBIT", detail: "10 pts behind the lead" });
  });

  it("statuses never change scores and appear in the public payload", async () => {
    const a = (await makeTeam("A")).team;
    await giveScore(a.id, 30);
    await on();
    const pub = await getUniversePublic({ fresh: true });
    expect(pub.statuses[a.id].code).toBe("FULL_MOON");
    expect(await scoreOf(a.id)).toEqual({ ledger: 30, cached: 30 });
  });
});

describe("🌌 Cosmic events", () => {
  it("13. suggestions never auto-activate", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const b = (await makeTeam("B")).team;
    await giveScore(a.id, 80);
    await giveScore(b.id, 10);
    for (let i = 0; i < 5; i++) {
      await withTx((tx) => suggestCosmicEvents(tx));
      await runTick({ force: true });
    }
    const ev = await db()`select kind, status from chaos_events`;
    expect(ev.length).toBeGreaterThanOrEqual(1);
    expect(ev.find((e) => e.kind === "HUNT_THE_LEADER")?.status).toBe("suggested");
    expect(ev.every((e) => e.status === "suggested")).toBe(true);
    expect(ev.filter((e) => e.kind === "HUNT_THE_LEADER")).toHaveLength(1); // deduplicated
    const pub = await getUniversePublic({ fresh: true });
    expect(pub.cosmic).toBeNull();
  });

  it("14. anomaly countdown: buildup hides the event, reveals at zero, only after admin GO LIVE", async () => {
    await on();
    const { id } = await createDraft({ kind: "BLACK_HOLE", points: 30, durationMinutes: 20 });
    const draftChallenge = await makeChallenge({ title: "t-boss", status: "draft", revealAt: null, points: 30 });
    const r = await goLive(id, { buildupSeconds: 180, linkedChallengeId: draftChallenge });
    const goes = new Date(r.goesLiveAt).getTime();
    expect(cosmicPhase({ status: "live", goesLiveAt: r.goesLiveAt, endsAt: r.endsAt }, goes - 179_000)).toBe("buildup");
    expect(cosmicPhase({ status: "live", goesLiveAt: r.goesLiveAt, endsAt: r.endsAt }, goes + 1)).toBe("active");
    expect(cosmicPhase({ status: "live", goesLiveAt: r.goesLiveAt, endsAt: r.endsAt }, goes + 21 * 60_000)).toBe("over");
    expect(cosmicPhase({ status: "suggested", goesLiveAt: null, endsAt: null }, goes)).toBe("none");
    const pub = await getUniversePublic({ fresh: true });
    expect(pub.cosmic).toEqual({ id, phase: "buildup", goesLiveAt: r.goesLiveAt });
    expect(JSON.stringify(pub)).not.toContain("t-boss");
    // Linked draft challenge is scheduled to reveal exactly at go-live — still hidden now.
    const [ch] = await db()`select status, reveal_at from challenges where id = ${draftChallenge}`;
    expect(ch.status).toBe("scheduled");
    expect(new Date(ch.reveal_at).toISOString()).toBe(r.goesLiveAt);
    invalidatePublicCache();
    expect((await getPublicState({ fresh: true })).challenges.find((c) => c.id === draftChallenge)).toBeUndefined();
    // Only one live event at a time.
    const second = await createDraft({ kind: "SOLAR_FLARE" });
    await expect(goLive(second.id, { buildupSeconds: 0 })).rejects.toThrow(/still live/);
    // Cancel during buildup puts the challenge back to draft.
    await endEvent(id, true);
    const [ch2] = await db()`select status from challenges where id = ${draftChallenge}`;
    expect(ch2.status).toBe("draft");
  });

  it("an event without buildup is active immediately and announced once", async () => {
    await on();
    const { id } = await createDraft({ kind: "ECLIPSE", durationMinutes: 10 });
    await goLive(id, { buildupSeconds: 0 });
    await runTick({ force: true });
    await runTick({ force: true });
    const ann = await db()`select headline, takeover from live_events where dedupe_key = ${`cosmic:${id}:live`}`;
    expect(ann).toHaveLength(1);
    const pub = await getUniversePublic({ fresh: true });
    expect(pub.cosmic?.phase).toBe("active");
    expect(pub.eclipse).toBe(true);
  });

  it("admin universe API rejects unauthenticated callers", async () => {
    const res = await universeAdminRoute(new Request("http://localhost/api/admin/universe", {
      method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify({ action: "settings", enabled: true }),
    }), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(401);
  });
});

describe("📺 Projector queue", () => {
  it("15. oldest first, skips seen and stale items (no replay after reconnect)", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const items = [
      { id: "12", createdAt: "2026-09-26T11:59:50Z", importance: "breaking" as const },
      { id: "10", createdAt: "2026-09-26T11:59:20Z", importance: "hot" as const },
      { id: "11", createdAt: "2026-09-26T11:59:20Z", importance: "breaking" as const },
      { id: "9", createdAt: "2026-09-26T11:50:00Z", importance: "breaking" as const },
      { id: "13", createdAt: "2026-09-26T11:59:55Z", importance: "breaking" as const },
    ];
    expect(buildTakeoverQueue(items, new Set(["13"]), now).map((i) => i.id)).toEqual(["10", "11", "12"]);
  });
});

describe("regressions — core behaviour unchanged with the universe ON", () => {
  it("16+17. scoring and submissions behave exactly as before", async () => {
    await on();
    const a = (await makeTeam("Alpha")).team;
    const b = (await makeTeam("Bravo")).team;
    const cid = await makeChallenge({ type: "FIRST_GLOBAL", points: 20 });
    const sa = await submitApplication(a.id, { challengeId: cid, description: "first" });
    const sb = await submitApplication(b.id, { challengeId: cid, description: "second" });
    await expect(approveSubmission(sb.id)).rejects.toThrow(/Alpha applied earlier/);
    await approveSubmission(sa.id);
    await runTick({ force: true });
    await runTick({ force: true });
    expect(await scoreOf(a.id)).toEqual({ ledger: 20, cached: 20 });
    const [bRow] = await db()`select status from challenge_submissions where id = ${sb.id}`;
    expect(bRow.status).toBe("rejected");
    invalidatePublicCache();
    const pub = await getPublicState({ fresh: true });
    expect(pub.leaderboard.map((r) => [r.name, r.score])).toEqual([["Alpha", 20], ["Bravo", 0]]);
    // The universe tick wrote nothing to the competition tables.
    const [{ n }] = await db()`select count(*)::int as n from score_ledger`;
    expect(n).toBe(1);
  });

  it("18. voting behaves exactly as before", async () => {
    await on();
    const a = await makeTeam("Alpha", ["Ada"]);
    const b = await makeTeam("Bravo", ["Ben"]);
    await setVotingState("open");
    await expect(castVote(a.participants[0].voteCode, a.team.id, "1.1.1.1")).rejects.toThrow(/own team/);
    await castVote(a.participants[0].voteCode, b.team.id, "1.1.1.1");
    await expect(castVote(a.participants[0].voteCode, b.team.id, "1.1.1.1")).rejects.toThrow(/already voted/);
  });

  it("19. registration and login behave exactly as before", async () => {
    await on();
    const res = await register(new Request("http://localhost/api/team/register", {
      method: "POST", headers: { host: "localhost", "content-type": "application/json", "x-forwarded-for": "7.7.7.7" },
      body: JSON.stringify({ name: "Nova", participants: ["A", "B"] }),
    }), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    const login = await teamLogin(new Request("http://localhost/api/team/login", {
      method: "POST", headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ teamId: body.team.id, code: body.accessCode }),
    }), { params: Promise.resolve({}) } as never);
    expect(login.status).toBe(200);
    const u = await getUniverseTeam(body.team.id);
    expect(u.enabled).toBe(true);
  });

  it("if universe tables were missing, the public universe API degrades to 'off' instead of failing", async () => {
    await on();
    await db()`alter table live_events rename to live_events_tmp`;
    try {
      const pub = await getUniversePublic({ fresh: true });
      expect(pub.enabled).toBe(false);
      invalidatePublicCache();
      expect((await getPublicState({ fresh: true })).leaderboard).toBeDefined();
    } finally {
      await db()`alter table live_events_tmp rename to live_events`;
    }
  });

  it("grantPower is idempotent per submission", async () => {
    await on();
    const a = (await makeTeam("A")).team;
    const cid = await makeChallenge({ points: 5 });
    const s = await submitApplication(a.id, { challengeId: cid, description: "done the thing" });
    await approveSubmission(s.id);
    const one = await withTx((tx) => grantPower(tx, { teamId: a.id, type: "SHIELD", source: "challenge", submissionId: s.id }));
    const two = await withTx((tx) => grantPower(tx, { teamId: a.id, type: "SHIELD", source: "challenge", submissionId: s.id }));
    expect(one).toBeTruthy();
    expect(two).toBeNull();
  });
});
