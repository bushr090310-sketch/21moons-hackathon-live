"use client";

import { Archive, Check, Copy, KeyRound, Pencil, Printer, RefreshCw, RotateCcw, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Empty, Input, Label, Modal, Textarea, cx } from "@/components/ui";
import type { AdminCtx } from "../admin-app";
import { SectionTitle, type AdminTeam } from "./shared";

interface CodeCard {
  title: string;
  teams: { name: string; accessCode?: string; voters: { name: string; code: string }[] }[];
}

export function TeamsTab(ctx: AdminCtx) {
  const { s, act, confirm, focus } = ctx;
  const [showForm, setShowForm] = useState(focus === "new" || s.teams.length === 0);
  const [card, setCard] = useState<CodeCard | null>(null);
  const [edit, setEdit] = useState<AdminTeam | null>(null);
  const [adding, setAdding] = useState<AdminTeam | null>(null);
  const hasDemo = s.teams.some((t) => t.isDemo);

  const teamCardFrom = (r: unknown, title: string): CodeCard => {
    const x = r as { team: { name: string }; accessCode?: string; participants: { name: string; voteCode: string }[] };
    return { title, teams: [{ name: x.team.name, accessCode: x.accessCode, voters: x.participants.map((p) => ({ name: p.name, code: p.voteCode })) }] };
  };

  const regenTeam = async (t: AdminTeam) => {
    const r = await confirm({ title: `New login code for ${t.name}?`, body: "The old code stops working and the team is signed out on all devices.", confirmLabel: "Generate new code", danger: true });
    if (!r.ok) return;
    const res = await act({ action: "team.regenerate_code", id: t.id }, "New team code generated");
    if (res.ok) setCard(teamCardFrom(res.result, "New team login code"));
  };

  const regenVotes = async (opts: { teamId?: string; participantId?: string; all?: boolean }, label: string) => {
    const r = await confirm({ title: `Regenerate ${label}?`, body: "Old voting codes stop working. Existing votes are kept.", confirmLabel: "Regenerate", danger: true });
    if (!r.ok) return;
    const res = await act({ action: "vote_codes.regenerate", ...opts }, "Voting codes regenerated");
    if (!res.ok) return;
    const rows = res.result as { team: string; name: string; voteCode: string }[];
    const byTeam = new Map<string, { name: string; code: string }[]>();
    for (const row of rows) byTeam.set(row.team, [...(byTeam.get(row.team) ?? []), { name: row.name, code: row.voteCode }]);
    setCard({ title: "Voting codes", teams: [...byTeam.entries()].map(([name, voters]) => ({ name, voters })) });
  };

  const archive = async (t: AdminTeam) => {
    const r = await confirm({
      title: t.active ? `Archive ${t.name}?` : `Restore ${t.name}?`,
      body: t.active ? "The team disappears from leaderboards and is signed out. Its ledger history is kept." : "The team appears on the leaderboard again (they need their code to sign in).",
      confirmLabel: t.active ? "Archive" : "Restore",
      danger: t.active,
    });
    if (r.ok) await act({ action: "team.update", id: t.id, active: !t.active }, t.active ? "Team archived" : "Team restored");
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionTitle right={
          <>
            {!showForm && <Button size="sm" variant="primary" onClick={() => setShowForm(true)}><UserPlus className="size-4" /> Add team</Button>}
            <Button size="sm" onClick={() => regenVotes({ all: true }, "ALL voting codes")} disabled={!s.teams.some((t) => t.active && t.participants.length)}><Printer className="size-4" /> Reprint all voting codes</Button>
          </>
        }>
          Teams ({s.teams.filter((t) => t.active).length})
        </SectionTitle>
        {showForm && <NewTeamForm act={act} onCreated={(r) => setCard(teamCardFrom(r, "Team created — hand out these codes"))} onCancel={() => setShowForm(false)} canCancel={s.teams.length > 0} />}
      </section>

      {s.teams.length === 0 ? <Empty icon={<Users className="size-6" />} title="No teams yet">Add the first team above.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {s.teams.map((t) => (
            <article key={t.id} className={cx("panel p-4", !t.active && "opacity-60")}>
              <header className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{t.name}</h3>
                    {!t.active && <Badge>Archived</Badge>}
                    {t.isDemo && <Badge tone="warn">Demo</Badge>}
                    {t.selfRegistered && <Badge tone="cyan">Self-registered</Badge>}
                  </div>
                  {t.description && <p className="text-sm text-mist">{t.description}</p>}
                </div>
                <span className="text-2xl font-semibold tabular">{t.score}</span>
              </header>
              <ul className="mt-3 flex flex-col divide-y divide-line rounded-lg border border-line">
                {t.participants.length === 0 && <li className="px-3 py-2 text-sm text-dim">No participants</li>}
                {t.participants.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.voted && <span className="inline-flex items-center gap-1 text-xs text-ok"><Check className="size-3" /> voted</span>}
                    <button className="rounded p-1 text-dim hover:text-silver" title="Rename" onClick={async () => {
                      const r = await confirm({ title: "Rename participant", input: { label: "Name", initial: p.name, required: true }, confirmLabel: "Save" });
                      if (r.ok) await act({ action: "participant.rename", id: p.id, name: r.value }, "Renamed");
                    }}><Pencil className="size-3.5" /></button>
                    <button className="rounded p-1 text-dim hover:text-silver" title="New voting code" onClick={() => regenVotes({ participantId: p.id }, `${p.name}'s voting code`)}><KeyRound className="size-3.5" /></button>
                    <button className="rounded p-1 text-dim hover:text-bad" title="Remove" onClick={async () => {
                      const r = await confirm({ title: `Remove ${p.name}?`, body: p.voted ? "Their vote will be deleted too." : undefined, confirmLabel: "Remove", danger: true });
                      if (r.ok) await act({ action: "participant.remove", id: p.id }, "Participant removed");
                    }}><Trash2 className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => setAdding(t)}><UserPlus className="size-3.5" /> Add people</Button>
                <Button size="sm" onClick={() => regenTeam(t)}><KeyRound className="size-3.5" /> New team code</Button>
                <Button size="sm" onClick={() => regenVotes({ teamId: t.id }, `voting codes for ${t.name}`)} disabled={!t.participants.length}><RefreshCw className="size-3.5" /> Voting codes</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(t)}><Pencil className="size-3.5" /> Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => archive(t)}>{t.active ? <><Archive className="size-3.5" /> Archive</> : <><RotateCcw className="size-3.5" /> Restore</>}</Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="panel p-4">
        <SectionTitle>Demo data</SectionTitle>
        <p className="mb-3 text-sm text-mist">Load 3 fake teams (Lunar Labs, Orbit AI, Apollo Works) to rehearse. <b className="text-warn">Remove them before the event</b> — removal deletes demo teams and all their points/applications and touches nothing else.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={async () => { const r = await act({ action: "demo.seed" }, "Demo teams loaded"); if (r.ok && Array.isArray(r.result) && r.result.length) setCard({ title: "Demo team codes", teams: (r.result as { team: { name: string }; accessCode: string; participants: { name: string; voteCode: string }[] }[]).map((x) => ({ name: x.team.name, accessCode: x.accessCode, voters: x.participants.map((p) => ({ name: p.name, code: p.voteCode })) })) }); }}>Load demo teams</Button>
          <Button size="sm" variant="danger" disabled={!hasDemo} onClick={async () => {
            const r = await confirm({ title: "Remove all demo teams?", body: "Deletes teams flagged as demo with all their data. Real teams are untouched.", confirmLabel: "Remove demo data", danger: true });
            if (r.ok) await act({ action: "demo.remove" }, "Demo teams removed");
          }}>Remove demo teams</Button>
        </div>
      </section>

      <EditTeamModal team={edit} onClose={() => setEdit(null)} act={act} />
      <AddPeopleModal team={adding} onClose={() => setAdding(null)} act={act} onCard={(r) => setCard(teamCardFrom(r, "New participants — voting codes"))} />
      <CodeCardModal card={card} onClose={() => setCard(null)} />
    </div>
  );
}

function NewTeamForm({ act, onCreated, onCancel, canCancel }: { act: AdminCtx["act"]; onCreated: (r: unknown) => void; onCancel: () => void; canCancel: boolean }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState("");
  const [busy, setBusy] = useState(false);
  const count = people.split(/\n|,/).map((x) => x.trim()).filter(Boolean).length;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await act({ action: "team.create", name, description: description || null, participants: people }, `Team ${name} created`);
    setBusy(false);
    if (r.ok) { setName(""); setDescription(""); setPeople(""); onCreated(r.result); }
  };
  return (
    <form onSubmit={submit} className="panel grid gap-3 p-4 sm:grid-cols-2">
      <div className="flex flex-col gap-3">
        <label><Label>Team name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Lunar Labs" required autoFocus /></label>
        <label><Label hint="optional">Short description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} placeholder="What are they building?" /></label>
      </div>
      <label><Label hint={`${count} ${count === 1 ? "person" : "people"}`}>Participants — one per line</Label><Textarea rows={5} value={people} onChange={(e) => setPeople(e.target.value)} placeholder={"John Doe\nSara Example\nAdam Test"} /></label>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {canCancel && <Button type="button" variant="ghost" onClick={onCancel}>Close</Button>}
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>Save team & generate codes</Button>
      </div>
    </form>
  );
}

function EditTeamModal({ team, onClose, act }: { team: AdminTeam | null; onClose: () => void; act: AdminCtx["act"] }) {
  return (
    <Modal open={!!team} onClose={onClose} title={team ? `Edit ${team.name}` : ""}>
      {team && <EditTeamForm key={team.id} team={team} onClose={onClose} act={act} />}
    </Modal>
  );
}
function EditTeamForm({ team, onClose, act }: { team: AdminTeam; onClose: () => void; act: AdminCtx["act"] }) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-col gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await act({ action: "team.update", id: team.id, name, description: description || null }, "Team saved");
      setBusy(false);
      if (r.ok) onClose();
    }}>
      <label><Label>Team name</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></label>
      <label><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} /></label>
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Save</Button></div>
    </form>
  );
}

function AddPeopleModal({ team, onClose, act, onCard }: { team: AdminTeam | null; onClose: () => void; act: AdminCtx["act"]; onCard: (r: unknown) => void }) {
  const [people, setPeople] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!team} onClose={onClose} title={team ? `Add people to ${team.name}` : ""}>
      <Textarea rows={5} value={people} onChange={(e) => setPeople(e.target.value)} placeholder="One name per line" autoFocus />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!people.trim()} onClick={async () => {
          if (!team) return;
          setBusy(true);
          const r = await act({ action: "team.add_participants", id: team.id, participants: people }, "Participants added");
          setBusy(false);
          if (r.ok) { setPeople(""); onClose(); onCard(r.result); }
        }}>Add & generate voting codes</Button>
      </div>
    </Modal>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="no-print rounded p-1 text-dim hover:text-silver"
      title="Copy"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
      }}
    >
      {done ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
    </button>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function printCard(card: CodeCard) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const body = card.teams.map((t) => `
    <section class="card">
      <div class="brand">21MOONS HACKATHON</div>
      <h2>${escapeHtml(t.name)}</h2>
      ${t.accessCode ? `<div class="label">Team login code — ${escapeHtml(location.host)}/team</div><div class="code big">${escapeHtml(t.accessCode)}</div>` : ""}
      ${t.voters.length ? `<div class="label">Personal voting codes — ${escapeHtml(location.host)}/vote</div><table>${t.voters.map((v) => `<tr><td>${escapeHtml(v.name)}</td><td class="code">${escapeHtml(v.code)}</td></tr>`).join("")}</table>` : ""}
    </section>`).join("");
  w.document.write(`<!doctype html><html><head><title>21MOONS codes</title><style>
    body{font-family:system-ui,sans-serif;margin:24px;color:#000}
    .card{border:2px solid #000;border-radius:12px;padding:20px;margin-bottom:20px;break-inside:avoid}
    .brand{letter-spacing:.3em;font-size:11px;font-weight:700}
    h2{margin:8px 0 14px;font-size:26px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#444;margin-top:10px}
    .code{font-family:ui-monospace,monospace;font-weight:700;letter-spacing:.12em}
    .big{font-size:30px;margin:6px 0 10px}
    table{border-collapse:collapse;width:100%;margin-top:6px}td{border-top:1px solid #ccc;padding:6px 4px;font-size:16px}
  </style></head><body>${body}<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

function CodeCardModal({ card, onClose }: { card: CodeCard | null; onClose: () => void }) {
  return (
    <Modal open={!!card} onClose={onClose} wide title={card?.title}>
      {card && (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
            Codes are shown <b>only now</b> (they are stored hashed). Copy or print them before closing — you can always regenerate.
          </p>
          {card.teams.map((t) => (
            <div key={t.name} className="rounded-xl border border-line-strong p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-violet">Team</p>
              <p className="text-2xl font-semibold">{t.name}</p>
              {t.accessCode && (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-dim">Team login code</p>
                  <div className="flex items-center gap-2"><span className="font-mono text-2xl font-semibold tracking-[0.15em] text-cyan">{t.accessCode}</span><CopyButton value={t.accessCode} /></div>
                </div>
              )}
              {t.voters.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-dim">Voting codes</p>
                  <ul className="mt-1 divide-y divide-line">
                    {t.voters.map((v) => (
                      <li key={v.name + v.code} className="flex items-center gap-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate">{v.name}</span>
                        <span className="font-mono font-semibold tracking-[0.15em]">{v.code}</span>
                        <CopyButton value={`${v.name}: ${v.code}`} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => {
              const text = card.teams.map((t) => [`TEAM: ${t.name}`, t.accessCode ? `TEAM LOGIN CODE: ${t.accessCode}` : null, t.voters.length ? "VOTING CODES:" : null, ...t.voters.map((v) => `${v.name} — ${v.code}`)].filter(Boolean).join("\n")).join("\n\n");
              void navigator.clipboard.writeText(text);
            }}><Copy className="size-4" /> Copy all</Button>
            <Button onClick={() => printCard(card)}><Printer className="size-4" /> Print</Button>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
