"use client";

import { Archive, Radio, Rocket, Shield, Swords, Tv, X, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import type { UniverseAdminState } from "@/lib/server/universe/state";
import { BUILDUP_OPTIONS, COSMIC, COSMIC_KINDS, POWERS, POWER_TYPES, relTime, type CosmicKind, type PowerType } from "@/lib/shared/universe";
import { fmtCountdown, fmtTime, fmtTimeSec } from "@/lib/shared/time";
import { useLiveData } from "@/components/live";
import { useToast } from "@/components/toast";
import { Badge, Button, Empty, Input, Label, Modal, Select, Spinner, Textarea, api, cx } from "@/components/ui";
import type { AdminCtx } from "../admin-app";
import { SectionTitle, Toggle } from "./shared";

type U = UniverseAdminState;

export function UniverseTab({ now, confirm }: AdminCtx) {
  const live = useLiveData<U>("/api/admin/universe", { channel: "admin", interval: 6000 });
  const toast = useToast();
  const act = useCallback(async (payload: Record<string, unknown>, msg?: string) => {
    try {
      const r = await api<{ result: unknown }>("/api/admin/universe", payload);
      if (msg) toast.success(msg);
      await live.refresh();
      return { ok: true, result: r.result };
    } catch (e) {
      toast.error((e as Error).message);
      return { ok: false, result: null };
    }
  }, [toast, live]);

  const u = live.data;
  if (!u) return live.error ? <Empty title="Live Universe unavailable">{live.error} — the rest of the admin works normally.</Empty> : <Spinner label="Loading universe…" />;
  const on = u.envAllowed && u.settings.enabled;

  return (
    <div className="flex flex-col gap-6">
      <section className="panel flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet">🌌 Live Universe</p>
          <p className="mt-1 text-sm text-mist">Engagement layer on top of the competition. Switching it off hides everything instantly; scores, challenges and voting are unaffected.</p>
          {!u.envAllowed && <p className="mt-1 text-sm text-warn">Disabled in this environment (preview or UNIVERSE_DISABLED).</p>}
        </div>
        <div className="flex flex-col sm:w-72">
          <Toggle label={on ? "Universe ON" : "Universe OFF"} hint="Shows news, statuses, powers & events" checked={u.settings.enabled} onChange={async (v) => {
            const r = await confirm({ title: v ? "Switch the Universe ON?" : "Switch the Universe OFF?", body: v ? "Lunar Network, Moon statuses and powers appear on all screens. History is not announced — news starts from now." : "All universe UI disappears. Nothing in the competition changes.", confirmLabel: v ? "Switch on" : "Switch off", danger: !v });
            if (r.ok) await act({ action: "settings", enabled: v }, v ? "Universe ON" : "Universe OFF");
          }} />
          <Toggle label="Automatic headlines" hint="Leader changes, overtakes, surges…" checked={u.settings.autoNews} onChange={(v) => void act({ action: "settings", autoNews: v }, "Saved")} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <NewsSection u={u} now={now} act={act} confirm={confirm} />
        <CosmicSection u={u} now={now} act={act} confirm={confirm} />
        <PowersSection u={u} act={act} confirm={confirm} />
        <div className="flex flex-col gap-6">
          <StatusSection u={u} act={act} />
          <AttackSection u={u} />
          <ProjectorSection u={u} now={now} />
        </div>
      </div>
    </div>
  );
}

type Act = (payload: Record<string, unknown>, msg?: string) => Promise<{ ok: boolean; result: unknown }>;

function NewsSection({ u, now, act, confirm }: { u: U; now: number; act: Act; confirm: AdminCtx["confirm"] }) {
  const [emoji, setEmoji] = useState("📡");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [importance, setImportance] = useState<"normal" | "hot" | "breaking">("normal");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const presets = [
    { e: "🍕", h: "Supply drop", b: "Food has arrived" },
    { e: "👀", h: "Strange signals", b: "The judges just spotted something interesting" },
    { e: "⏰", h: "Final orbit", b: "60 minutes remain" },
  ];
  return (
    <section>
      <SectionTitle right={<Radio className="size-4 text-bad" />}>📡 Lunar Network</SectionTitle>
      <form className="panel flex flex-col gap-3 p-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await act({ action: "news.publish", headline, body: body || null, importance, teamId: teamId || null, emoji }, "Published to the Lunar Network");
        setBusy(false);
        if (r.ok) { setHeadline(""); setBody(""); setImportance("normal"); setTeamId(""); }
      }}>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => <button type="button" key={p.h} onClick={() => { setEmoji(p.e); setHeadline(p.h); setBody(p.b); }} className="rounded-full border border-line px-3 py-1 text-xs text-mist hover:text-silver">{p.e} {p.h}</button>)}
        </div>
        <div className="grid grid-cols-[64px_1fr] gap-2">
          <label><Label>Icon</Label><Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="text-center" maxLength={8} /></label>
          <label><Label>Headline *</Label><Input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={120} required /></label>
        </div>
        <label><Label>Message</Label><Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label><Label hint="hot/breaking → projector takeover">Importance</Label>
            <Select value={importance} onChange={(e) => setImportance(e.target.value as typeof importance)}>
              <option value="normal">Normal</option><option value="hot">Hot</option><option value="breaking">Breaking</option>
            </Select>
          </label>
          <label><Label hint="optional">Team</Label>
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">—</option>{u.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </label>
        </div>
        <Button type="submit" variant="primary" loading={busy} disabled={headline.trim().length < 2}>Publish</Button>
      </form>
      <ul className="panel mt-3 max-h-[420px] divide-y divide-line overflow-y-auto">
        {u.news.length === 0 && <li className="p-4 text-sm text-dim">No news yet.</li>}
        {u.news.map((n) => (
          <li key={n.id} className={cx("flex items-start gap-3 px-4 py-2.5 text-sm", n.archived && "opacity-40")}>
            <span>{n.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-silver">{n.headline}</p>
              {n.body && <p className="truncate text-xs text-mist">{n.body}</p>}
              <div className="mt-1 flex gap-1.5">
                <Badge tone={n.source === "admin" ? "violet" : "neutral"}>{n.source}</Badge>
                {n.importance !== "normal" && <Badge tone={n.importance === "breaking" ? "bad" : "warn"}>{n.importance}</Badge>}
                {n.takeover && <Badge tone="cyan">projector</Badge>}
                {n.archived && <Badge>archived</Badge>}
              </div>
            </div>
            <span className="shrink-0 text-xs tabular text-dim">{relTime(n.createdAt, now)}</span>
            {!n.archived && (
              <button title="Archive (hide from feed)" className="shrink-0 rounded p-1 text-dim hover:text-bad" onClick={async () => {
                const r = await confirm({ title: "Archive this news item?", body: "It disappears from every feed. No competition data changes.", confirmLabel: "Archive" });
                if (r.ok) await act({ action: "news.archive", id: Number(n.id) }, "Archived");
              }}><Archive className="size-4" /></button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusSection({ u, act }: { u: U; act: Act }) {
  return (
    <section>
      <SectionTitle>🌕 Moon status <span className="normal-case tracking-normal text-dim">(derived · never affects pts)</span></SectionTitle>
      <div className="panel p-4">
        <label className="mb-3 block"><Label>🔭 One to watch (editorial pick)</Label>
          <Select value={u.settings.oneToWatchTeamId ?? ""} onChange={(e) => void act({ action: "settings", oneToWatchTeamId: e.target.value || null }, "Saved")}>
            <option value="">— none —</option>{u.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </label>
        <ul className="divide-y divide-line text-sm">
          {u.statuses.map((s) => (
            <li key={s.teamId} className="flex items-center gap-3 py-2">
              <span className="w-6 text-right tabular text-dim">{s.rank}</span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs text-violet">{s.status ? `${s.status.emoji} ${s.status.label} · ${s.status.detail}` : "—"}</span>
              <span className="w-12 text-right font-semibold tabular">{s.score}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PowersSection({ u, act, confirm }: { u: U; act: Act; confirm: AdminCtx["confirm"] }) {
  const [team, setTeam] = useState("");
  const [type, setType] = useState<PowerType>("SABOTAGE_5");
  const [rewardCh, setRewardCh] = useState("");
  const [rewardType, setRewardType] = useState<PowerType>("SABOTAGE_5");
  const inventory = new Map<string, { team: string; items: U["powers"] }>();
  for (const p of u.powers) {
    if (p.status !== "available") continue;
    const e = inventory.get(p.teamId) ?? { team: p.team, items: [] };
    e.items.push(p);
    inventory.set(p.teamId, e);
  }
  return (
    <section>
      <SectionTitle right={<Shield className="size-4 text-mist" />}>☄️ Cosmic powers</SectionTitle>
      <div className="panel flex flex-col gap-4 p-4">
        <div>
          <Label>Grant a power manually</Label>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">Team…</option>{u.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            <Select value={type} onChange={(e) => setType(e.target.value as PowerType)}>{POWER_TYPES.map((t) => <option key={t} value={t}>{POWERS[t].emoji} {POWERS[t].name}</option>)}</Select>
            <Button variant="primary" disabled={!team} onClick={async () => {
              const t = u.teams.find((x) => x.id === team);
              const r = await confirm({ title: `Give ${POWERS[type].name} to ${t?.name}?`, body: POWERS[type].does, confirmLabel: "Grant" });
              if (r.ok) await act({ action: "power.grant", teamId: team, type }, "Power granted");
            }}>Grant</Button>
          </div>
        </div>
        <div>
          <Label hint="applies to approvals from now on — never retroactive">Challenge reward</Label>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Select value={rewardCh} onChange={(e) => setRewardCh(e.target.value)}><option value="">Challenge…</option>{u.challenges.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.title} ({c.status})</option>)}</Select>
            <Select value={rewardType} onChange={(e) => setRewardType(e.target.value as PowerType)}>{POWER_TYPES.map((t) => <option key={t} value={t}>{POWERS[t].emoji} {POWERS[t].name}</option>)}</Select>
            <Button disabled={!rewardCh} onClick={async () => {
              const r = await confirm({ title: "Attach power reward?", body: "Every team approved for this challenge FROM NOW ON also receives this power. Points of the challenge are unchanged.", confirmLabel: "Attach" });
              if (r.ok) await act({ action: "reward.set", challengeId: rewardCh, type: rewardType }, "Reward attached");
            }}>Attach</Button>
          </div>
          {u.rewards.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {u.rewards.map((r) => (
                <li key={r.challengeId} className="flex items-center gap-2">
                  <span>{r.emoji} {r.title}</span><span className="text-mist">→ {POWERS[r.type].emoji} {POWERS[r.type].name}</span>
                  <button className="ml-auto text-dim hover:text-bad" title="Remove reward" onClick={() => void act({ action: "reward.set", challengeId: r.challengeId, type: null }, "Reward removed")}><X className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <Label>Inventories (unused)</Label>
          {inventory.size === 0 ? <p className="text-sm text-dim">No team holds a power.</p> : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...inventory.values()].map((e) => (
                <li key={e.team} className="flex flex-wrap items-center gap-2">
                  <span className="w-32 truncate font-medium">{e.team}</span>
                  {e.items.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
                      {POWERS[p.type].emoji} {POWERS[p.type].name}
                      <button className="text-dim hover:text-bad" title="Revoke unused power" onClick={async () => {
                        const r = await confirm({ title: `Revoke ${POWERS[p.type].name} from ${e.team}?`, input: { label: "Reason", required: true }, confirmLabel: "Revoke", danger: true });
                        if (r.ok) await act({ action: "power.revoke", id: p.id, reason: r.value }, "Power revoked");
                      }}><X className="size-3" /></button>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function AttackSection({ u }: { u: U }) {
  return (
    <section>
      <SectionTitle right={<Swords className="size-4 text-mist" />}>⚔️ Attack history</SectionTitle>
      {u.attacks.length === 0 ? <Empty title="No attacks yet" /> : (
        <ul className="panel max-h-72 divide-y divide-line overflow-y-auto text-sm">
          {u.attacks.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-4 py-2">
              <span>{POWERS[a.type].emoji}</span>
              <span className="min-w-0 flex-1 truncate"><b>{a.attacker}</b> → <b>{a.target}</b></span>
              {a.blocked ? <Badge tone="cyan">blocked</Badge> : <span className="font-semibold tabular text-bad">{a.applied}</span>}
              {a.ledgerId && <span className="text-xs text-dim">#{a.ledgerId}</span>}
              <span className="text-xs tabular text-dim">{fmtTimeSec(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CosmicSection({ u, now, act, confirm }: { u: U; now: number; act: Act; confirm: AdminCtx["confirm"] }) {
  const [edit, setEdit] = useState<U["events"][number] | null>(null);
  const [kind, setKind] = useState<CosmicKind>("SOLAR_FLARE");
  const liveEv = u.events.find((e) => e.status === "live");
  const suggested = u.events.filter((e) => e.status === "suggested");
  const drafts = u.events.filter((e) => e.status === "draft");
  return (
    <section>
      <SectionTitle right={<Zap className="size-4 text-warn" />}>🌌 Cosmic events</SectionTitle>
      <div className="panel flex flex-col gap-4 p-4">
        {liveEv ? (
          <div className="rounded-lg border border-violet/40 bg-violet/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet">{liveEv.phase === "buildup" ? "Buildup on projector" : "Live now"}</p>
            <p className="mt-1 font-semibold">{COSMIC[liveEv.kind].emoji} {liveEv.title}</p>
            <p className="text-sm text-mist">{liveEv.explanation}</p>
            <p className="mt-1 text-xs text-mist">
              {liveEv.phase === "buildup" && liveEv.goesLiveAt ? <>Reveals in <b className="tabular text-warn">{fmtCountdown(new Date(liveEv.goesLiveAt).getTime() - now)}</b></> : null}
              {liveEv.endsAt ? <> · ends {fmtTime(liveEv.endsAt)}</> : null}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={async () => { const r = await confirm({ title: "End this event now?", confirmLabel: "End event" }); if (r.ok) await act({ action: "cosmic.end", id: liveEv.id }, "Event ended"); }}>End</Button>
              <Button size="sm" variant="danger" onClick={async () => { const r = await confirm({ title: "Cancel this event?", body: "A linked challenge that hasn't been revealed yet goes back to draft.", confirmLabel: "Cancel event", danger: true }); if (r.ok) await act({ action: "cosmic.end", id: liveEv.id, cancel: true }, "Event cancelled"); }}>Cancel</Button>
            </div>
          </div>
        ) : <p className="text-sm text-dim">No cosmic event is live. The system only suggests — nothing starts until you press GO LIVE.</p>}

        <div>
          <Label>Suggested cosmic events</Label>
          {suggested.length === 0 ? <p className="text-sm text-dim">No suggestions right now.</p> : (
            <ul className="flex flex-col gap-2">
              {suggested.map((e) => (
                <li key={e.id} className="flex items-center gap-3 rounded-lg border border-line bg-white/[0.03] p-3">
                  <span className="text-xl">{COSMIC[e.kind].emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{e.title}</p>
                    <p className="text-xs text-mist">Why: {e.reason}</p>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => setEdit(e)}>Preview</Button>
                  <Button size="sm" variant="ghost" onClick={() => void act({ action: "cosmic.dismiss", id: e.id }, "Dismissed")}>Dismiss</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <Label>Start your own</Label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value as CosmicKind)}>{COSMIC_KINDS.map((k) => <option key={k} value={k}>{COSMIC[k].emoji} {COSMIC[k].title} — {COSMIC[k].explanation}</option>)}</Select>
            <Button onClick={async () => { const r = await act({ action: "cosmic.draft", kind }); if (r.ok) await act({ action: "tick" }); }}>Create draft</Button>
          </div>
          {drafts.map((e) => (
            <div key={e.id} className="mt-2 flex items-center gap-2 text-sm">
              <span>{COSMIC[e.kind].emoji} {e.title}</span><Badge>draft</Badge>
              <Button size="sm" className="ml-auto" variant="primary" onClick={() => setEdit(e)}>Preview</Button>
              <Button size="sm" variant="ghost" onClick={() => void act({ action: "cosmic.dismiss", id: e.id }, "Removed")}>Remove</Button>
            </div>
          ))}
        </div>
      </div>
      <GoLiveModal ev={edit} u={u} onClose={() => setEdit(null)} act={act} confirm={confirm} />
    </section>
  );
}

function GoLiveModal({ ev, u, onClose, act, confirm }: { ev: U["events"][number] | null; u: U; onClose: () => void; act: Act; confirm: AdminCtx["confirm"] }) {
  return (
    <Modal open={!!ev} onClose={onClose} title={ev ? `${COSMIC[ev.kind].emoji} ${ev.title}` : ""}>
      {ev && <GoLiveForm key={ev.id} ev={ev} u={u} onClose={onClose} act={act} confirm={confirm} />}
    </Modal>
  );
}

function GoLiveForm({ ev, u, onClose, act, confirm }: { ev: U["events"][number]; u: U; onClose: () => void; act: Act; confirm: AdminCtx["confirm"] }) {
  const [title, setTitle] = useState(ev.title);
  const [explanation, setExplanation] = useState(ev.explanation);
  const [buildup, setBuildup] = useState<number>(180);
  const [duration, setDuration] = useState(String(ev.durationMinutes ?? (ev.kind === "ECLIPSE" ? 15 : 20)));
  const [points, setPoints] = useState(String(ev.points ?? ""));
  const [challenge, setChallenge] = useState("");
  const drafts = u.challenges.filter((c) => c.status === "draft");
  return (
    <div className="flex flex-col gap-3">
      {ev.reason && <p className="text-xs text-mist">Suggested because: {ev.reason}</p>}
      <label><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></label>
      <label><Label>Plain explanation (shown to everyone)</Label><Textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={300} /></label>
      <div className="grid grid-cols-3 gap-2">
        <label><Label>Buildup</Label>
          <Select value={buildup} onChange={(e) => setBuildup(Number(e.target.value))}>
            {BUILDUP_OPTIONS.map((b) => <option key={b} value={b}>{b === 0 ? "Off" : b < 60 ? `${b} sec` : `${b / 60} min`}</option>)}
          </Select>
        </label>
        <label><Label>Minutes</Label><Input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        <label><Label hint="display">Pts</Label><Input inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
      </div>
      {ev.kind !== "ECLIPSE" && ev.kind !== "ANOMALY" && (
        <label><Label hint="a DRAFT challenge you prepared">Reveal challenge at go-live</Label>
          <Select value={challenge} onChange={(e) => setChallenge(e.target.value)}>
            <option value="">— none —</option>{drafts.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.title}</option>)}
          </Select>
        </label>
      )}
      <p className="rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-xs text-mist">
        {buildup > 0 ? `The projector shows "⚠️ COSMIC ANOMALY DETECTED" with a ${buildup < 60 ? `${buildup} s` : `${buildup / 60} min`} countdown, then reveals this event.` : "Reveals immediately on the projector."}
        {challenge ? " The selected challenge becomes visible at the reveal." : ""}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={async () => {
          const r = await confirm({ title: `GO LIVE: ${title}?`, body: explanation, confirmLabel: "GO LIVE" });
          if (!r.ok) return;
          const res = await act({
            action: "cosmic.go_live", id: ev.id, buildupSeconds: buildup, title, explanation,
            durationMinutes: duration ? Number(duration) : null, points: points ? Number(points) : null, linkedChallengeId: challenge || null,
          }, "Cosmic event is live");
          if (res.ok) onClose();
        }}><Rocket className="size-4" /> Go live</Button>
      </div>
    </div>
  );
}

function ProjectorSection({ u, now }: { u: U; now: number }) {
  const p = u.public;
  return (
    <section>
      <SectionTitle right={<Tv className="size-4 text-mist" />}>📺 Projector</SectionTitle>
      <div className="panel p-4 text-sm">
        {!p ? <p className="text-dim">Universe is off — projector shows the plain leaderboard.</p> : (
          <>
            <p className="text-mist">Cosmic: <b className="text-silver">{p.cosmic ? (p.cosmic.phase === "buildup" ? `anomaly countdown ${fmtCountdown(new Date(p.cosmic.goesLiveAt).getTime() - now)}` : `${p.cosmic.title} active`) : "none"}</b>{p.eclipse ? " · 🌘 scores hidden" : ""}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.2em] text-dim">Takeover queue (last 2 min)</p>
            {p.takeovers.length === 0 ? <p className="text-dim">Empty</p> : (
              <ul className="mt-1 flex flex-col gap-1">
                {[...p.takeovers].reverse().map((t) => <li key={t.id}>{t.emoji} {t.headline} <span className="text-xs text-dim">{relTime(t.createdAt, now)}</span></li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
