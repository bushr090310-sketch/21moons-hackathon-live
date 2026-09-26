// 🌌 COSMIC EVENTS — the system may only SUGGEST. Only an admin action sets status = 'live'.
import { COSMIC, BUILDUP_OPTIONS, type CosmicKind } from "@/lib/shared/universe";
import { iso, withTx, type Tx } from "../db";
import { badRequest, conflict, isUniqueViolation, notFound } from "../errors";
import { audit } from "../audit";
import { publishNews, requireUniverseLive } from "./core";

export interface CosmicDraft {
  kind: CosmicKind;
  title?: string;
  explanation?: string;
  buildupSeconds?: number;
  durationMinutes?: number | null;
  points?: number | null;
  linkedChallengeId?: string | null;
}

export async function suggestEvent(tx: Tx, kind: CosmicKind, reason: string, key: string) {
  const [recent] = await tx`
    select 1 from chaos_events where kind = ${kind} and status in ('suggested','live') and created_at > now() - interval '45 minutes' limit 1`;
  if (recent) return null;
  const c = COSMIC[kind];
  const rows = await tx`
    insert into chaos_events (kind, status, title, explanation, reason, suggestion_key)
    values (${kind}, 'suggested', ${c.title}, ${c.explanation}, ${reason}, ${key})
    on conflict (suggestion_key) do nothing returning id`;
  return rows[0]?.id ?? null;
}

export async function createDraft(d: CosmicDraft) {
  const c = COSMIC[d.kind];
  if (!c) throw badRequest("Unknown event");
  return withTx(async (tx) => {
    const [row] = await tx`
      insert into chaos_events (kind, status, title, explanation, duration_minutes, points)
      values (${d.kind}, 'draft', ${d.title?.trim() || c.title}, ${d.explanation?.trim() || c.explanation}, ${d.durationMinutes ?? null}, ${d.points ?? null})
      returning id`;
    await audit(tx, "universe.cosmic_draft", { kind: d.kind });
    return { id: row.id as string };
  });
}

export async function dismissEvent(id: string) {
  return withTx(async (tx) => {
    const r = await tx`update chaos_events set status = 'cancelled', updated_at = now() where id = ${id} and status in ('draft','suggested') returning kind`;
    if (!r.length) throw conflict("Only drafts or suggestions can be dismissed");
    await audit(tx, "universe.cosmic_dismissed", { id, kind: r[0].kind });
  });
}

/** ADMIN-ONLY: approve and start an event (optionally after a projector buildup). */
export async function goLive(id: string, d: Omit<CosmicDraft, "kind">) {
  const buildup = d.buildupSeconds ?? 0;
  if (!(BUILDUP_OPTIONS as readonly number[]).includes(buildup)) throw badRequest("Invalid buildup");
  try {
    return await withTx(async (tx) => {
      await requireUniverseLive(tx);
      const [e] = await tx`select * from chaos_events where id = ${id} for update`;
      if (!e) throw notFound("Event not found");
      if (e.status !== "draft" && e.status !== "suggested") throw conflict(`This event is already ${e.status}`);
      const [live] = await tx`select title from chaos_events where status = 'live' limit 1`;
      if (live) throw conflict(`"${live.title}" is still live — end it first`);
      const [{ now }] = await tx`select now() as now`;
      const goesLive = new Date(new Date(now).getTime() + buildup * 1000);
      const duration = d.durationMinutes ?? e.duration_minutes ?? null;
      const endsAt = duration ? new Date(goesLive.getTime() + duration * 60_000) : null;

      let challengeTitle: string | null = null;
      if (d.linkedChallengeId) {
        // Only a DRAFT challenge the organizer prepared can be linked; it is scheduled to reveal at go-live.
        const [ch] = await tx`select id, title, status from challenges where id = ${d.linkedChallengeId} for update`;
        if (!ch) throw notFound("Challenge not found");
        if (ch.status !== "draft") throw conflict("Only a draft (hidden) challenge can be linked to a cosmic event");
        await tx`update challenges set status = 'scheduled', reveal_at = ${goesLive}, expires_at = coalesce(${endsAt}, expires_at), updated_at = now() where id = ${ch.id}`;
        challengeTitle = ch.title;
        await audit(tx, "challenge.scheduled_by_cosmic_event", { challenge: ch.title, revealAt: goesLive.toISOString(), eventId: id });
      }
      await tx`
        update chaos_events set status = 'live', approved_at = now(), goes_live_at = ${goesLive}, ends_at = ${endsAt},
          buildup_seconds = ${buildup}, duration_minutes = ${duration}, points = coalesce(${d.points ?? null}::int, points),
          title = coalesce(${d.title?.trim() || null}, title), explanation = coalesce(${d.explanation?.trim() || null}, explanation),
          linked_challenge_id = coalesce(${d.linkedChallengeId ?? null}::uuid, linked_challenge_id),
          metadata = metadata || ${tx.json({ challengeTitle } as never)}, updated_at = now()
        where id = ${id}`;
      if (buildup > 0) {
        await publishNews(tx, {
          type: "ANOMALY", emoji: "⚠️", importance: "hot", headline: "COSMIC ANOMALY DETECTED",
          body: "Unknown activity in the 21MOONS universe. Watch the big screen.", dedupeKey: `cosmic:${id}:anomaly`,
        });
      }
      await audit(tx, "universe.cosmic_live", { id, kind: e.kind, buildupSeconds: buildup, goesLiveAt: goesLive.toISOString(), endsAt: iso(endsAt) });
      return { goesLiveAt: goesLive.toISOString(), endsAt: iso(endsAt) };
    });
  } catch (err) {
    if (isUniqueViolation(err, "chaos_events_one_live")) throw conflict("Another cosmic event is already live");
    throw err;
  }
}

export async function endEvent(id: string, cancel = false) {
  return withTx(async (tx) => {
    const [e] = await tx`select * from chaos_events where id = ${id} for update`;
    if (!e || e.status !== "live") throw conflict("Event is not live");
    // Cancelling during buildup: put a linked, not-yet-revealed challenge back to draft.
    if (cancel && e.linked_challenge_id) {
      await tx`update challenges set status = 'draft', updated_at = now()
               where id = ${e.linked_challenge_id} and status = 'scheduled' and reveal_at > now()`;
    }
    await tx`update chaos_events set status = ${cancel ? "cancelled" : "ended"}, ended_at = now(), updated_at = now() where id = ${id}`;
    await audit(tx, cancel ? "universe.cosmic_cancelled" : "universe.cosmic_ended", { id, kind: e.kind });
  });
}

/** Tick: announce events whose buildup finished; auto-end events past their end time. */
export async function cosmicLifecycle(tx: Tx) {
  const reveal = await tx`select * from chaos_events where status = 'live' and goes_live_at <= now()`;
  for (const e of reveal) {
    const c = COSMIC[e.kind as CosmicKind];
    const bits = [e.explanation, e.metadata?.challengeTitle ? `Challenge: ${e.metadata.challengeTitle}` : null, e.points ? `+${e.points} pts` : null, e.duration_minutes ? `${e.duration_minutes} minutes` : null].filter(Boolean);
    await publishNews(tx, {
      type: "COSMIC_EVENT", emoji: c.emoji, importance: "breaking", takeover: true,
      headline: `${e.title.toUpperCase()} EVENT`, body: bits.join(" · "),
      pointsDelta: e.points ?? null, dedupeKey: `cosmic:${e.id}:live`, metadata: { kind: e.kind, eventId: e.id },
    });
  }
  const ended = await tx`update chaos_events set status = 'ended', ended_at = now(), updated_at = now()
                          where status = 'live' and ends_at is not null and ends_at <= now() returning id, title`;
  for (const e of ended) {
    await publishNews(tx, { type: "COSMIC_ENDED", emoji: "🌌", headline: `${e.title.toUpperCase()} IS OVER`, dedupeKey: `cosmic:${e.id}:ended` });
  }
}
