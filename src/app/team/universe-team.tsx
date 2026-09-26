"use client";

import { useState } from "react";
import { POWERS, type PowerType } from "@/lib/shared/universe";
import { useLiveData } from "@/components/live";
import { useToast } from "@/components/toast";
import { Button, Modal, api, cx } from "@/components/ui";
import { UniverseBoundary } from "@/components/universe";

interface TeamUniverse {
  enabled: boolean;
  frozen?: boolean;
  powers?: { id: string; type: PowerType }[];
  targets?: { teamId: string; name: string; score: number; rank: number }[];
}

export function TeamUniverseSection() {
  return <UniverseBoundary><Inner /></UniverseBoundary>;
}

function Inner() {
  const live = useLiveData<TeamUniverse>("/api/universe/team", { channel: "public", interval: 10000 });
  const [help, setHelp] = useState(false);
  const [launch, setLaunch] = useState<{ id: string; type: PowerType } | null>(null);
  const u = live.data;
  if (!u?.enabled) return null;
  const powers = u.powers ?? [];
  const attacks = powers.filter((p) => p.type !== "SHIELD");
  const shields = powers.filter((p) => p.type === "SHIELD");
  const byType = (t: PowerType) => attacks.filter((p) => p.type === t);

  return (
    <>
      {powers.length > 0 && (
        <div className="panel p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-mist">Cosmic powers</h2>
          <ul className="flex flex-col gap-3">
            {(["SABOTAGE_5", "SABOTAGE_10"] as PowerType[]).filter((t) => byType(t).length).map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="text-2xl">{POWERS[t].emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-silver">{POWERS[t].name}</p>
                  <p className="text-xs text-mist">{POWERS[t].does} · {byType(t).length} available</p>
                </div>
                <Button size="sm" variant="primary" disabled={u.frozen} onClick={() => setLaunch(byType(t)[0])}>Use</Button>
              </li>
            ))}
            {shields.length > 0 && (
              <li className="flex items-center gap-3">
                <span className="text-2xl">{POWERS.SHIELD.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-silver">{POWERS.SHIELD.name}{shields.length > 1 ? ` ×${shields.length}` : ""}</p>
                  <p className="text-xs text-mist">{POWERS.SHIELD.does}</p>
                </div>
                <span className="rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ok">Active</span>
              </li>
            )}
          </ul>
          {u.frozen && <p className="mt-3 text-xs text-cyan/80">Powers are paused while the leaderboard is frozen.</p>}
        </div>
      )}
      <button onClick={() => setHelp(true)} className="self-start rounded-full border border-line px-3 py-1 text-xs text-mist hover:border-line-strong hover:text-silver">
        ? 21MOONS Universe
      </button>
      <HelpModal open={help} onClose={() => setHelp(false)} />
      <LaunchModal power={launch} targets={u.targets ?? []} onClose={() => setLaunch(null)} onDone={() => void live.refresh()} />
    </>
  );
}

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Welcome to the 21MOONS Universe">
      <div className="flex flex-col gap-4 text-sm text-mist">
        <p>Your team is one Moon competing for the top of the galaxy.<br /><b className="text-silver">Complete challenges → earn pts → climb the leaderboard.</b></p>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim">Cosmic powers</p>
          <ul className="flex flex-col gap-1.5">
            {(Object.keys(POWERS) as PowerType[]).map((t) => (
              <li key={t}><span className="mr-1">{POWERS[t].emoji}</span><b className="text-silver">{POWERS[t].name}</b> — {POWERS[t].does.replace("your next", "one")}.</li>
            ))}
          </ul>
        </div>
        <p><span className="mr-1">📡</span><b className="text-silver">Lunar Network</b> — live competition news and announcements.</p>
        <p>Cosmic Events may appear throughout the hackathon.</p>
      </div>
    </Modal>
  );
}

function LaunchModal({ power, targets, onClose, onDone }: { power: { id: string; type: PowerType } | null; targets: { teamId: string; name: string; score: number }[]; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open={!!power} onClose={onClose} title={power ? `${POWERS[power.type].emoji} ${POWERS[power.type].name}` : ""}>
      {power && <LaunchForm key={power.id} power={power} targets={targets} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function LaunchForm({ power, targets, onClose, onDone }: { power: { id: string; type: PowerType }; targets: { teamId: string; name: string; score: number }[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const p = POWERS[power.type];
  const [target, setTarget] = useState<{ teamId: string; name: string; score: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // One idempotency key per launch dialog: double-clicks and retries can never fire twice.
  const [requestId] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, ""));

  const launch = async () => {
    if (!target || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ result: { blocked: boolean; appliedDelta: number; target: string } }>("/api/universe/powers/use", { powerupId: power.id, targetTeamId: target.teamId, requestId });
      if (r.result.blocked) toast.info(`🛡️ ${r.result.target} had a Force Field`, "Your attack was blocked. No pts lost.");
      else toast.success(`${p.emoji} Direct hit on ${r.result.target}`, `${r.result.appliedDelta} pts`);
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (target) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-center text-lg font-semibold uppercase tracking-wider text-silver">{p.name} {target.name}?</p>
        <p className="text-center text-sm text-mist">They will lose {Math.min(p.value, target.score)} pts{target.score < p.value ? ` (they only have ${target.score})` : ""}. A Force Field would block it.</p>
        {err && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setTarget(null)} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={launch} loading={busy}>Launch {p.emoji}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-mist">{p.does}. Choose a Moon:</p>
      <ul className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto">
        {targets.map((t) => (
          <li key={t.teamId}>
            <button disabled={t.score <= 0} onClick={() => setTarget(t)}
              className={cx("flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left text-sm transition", t.score <= 0 ? "border-line text-dim" : "border-line-strong bg-white/[0.03] hover:bg-white/[0.07]")}>
              <span className="font-medium">{t.name}</span>
              <span className="tabular">{t.score} pts</span>
            </button>
          </li>
        ))}
      </ul>
      {targets.length === 0 && <p className="text-sm text-dim">No other Moons yet.</p>}
    </div>
  );
}
