"use client";

import { Download, Eye, Snowflake } from "lucide-react";
import { useState } from "react";
import { fmtTimeSec } from "@/lib/shared/time";
import { Button, Input, Label, Textarea } from "@/components/ui";
import type { AdminCtx } from "../admin-app";
import { SectionTitle, Toggle } from "./shared";

const DATASETS = ["final_scores", "teams", "participants", "challenges", "submissions", "ledger", "votes"];

export function SettingsTab({ s, act, confirm }: AdminCtx) {
  const [sponsors, setSponsors] = useState(s.settings.sponsors.join("\n"));
  const [announcement, setAnnouncement] = useState(s.settings.announcement ?? "");
  const frozen = s.settings.frozen;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <section className="panel p-4">
          <SectionTitle>Leaderboard freeze</SectionTitle>
          <p className="mb-3 text-sm text-mist">
            {frozen ? <>Public board is <b className="text-cyan">frozen</b> since {fmtTimeSec(s.settings.frozenAt)}. Real scores keep counting.</> : "Public board shows real scores live."}
          </p>
          <div className="flex flex-wrap gap-2">
            {!frozen && <Button onClick={async () => { const r = await confirm({ title: "Freeze the public leaderboard?", confirmLabel: "Freeze" }); if (r.ok) await act({ action: "leaderboard.freeze" }, "Frozen"); }}><Snowflake className="size-4" /> Freeze public board</Button>}
            {frozen && <Button variant="primary" onClick={async () => { const r = await confirm({ title: "Reveal the final leaderboard?", body: "Plays the reveal animation on all screens.", confirmLabel: "Reveal" }); if (r.ok) await act({ action: "leaderboard.reveal" }, "Revealed"); }}><Eye className="size-4" /> Reveal final leaderboard</Button>}
            {frozen && <Button variant="ghost" onClick={async () => { const r = await confirm({ title: "Unfreeze quietly?", body: "For mistakes: unfreezes without the reveal animation.", confirmLabel: "Unfreeze", danger: true }); if (r.ok) await act({ action: "leaderboard.unfreeze" }, "Unfrozen"); }}>Unfreeze quietly</Button>}
          </div>
        </section>

        <section className="panel p-4">
          <SectionTitle>Event switches</SectionTitle>
          <Toggle label="Accept applications" hint="Pause all team submissions (e.g. during final pitches)." checked={s.settings.submissionsOpen} onChange={async (v) => {
            if (!v) { const r = await confirm({ title: "Pause all applications?", confirmLabel: "Pause", danger: true }); if (!r.ok) return; }
            await act({ action: "settings.update", submissionsOpen: v }, v ? "Applications open" : "Applications paused");
          }} />
          <Toggle label="Show who claimed FIRST challenges" hint="Public cards show 'Claimed by Team X'." checked={s.settings.showFirstGlobalWinner} onChange={(v) => void act({ action: "settings.update", showFirstGlobalWinner: v }, "Saved")} />
        </section>

        <section className="panel p-4">
          <SectionTitle>Announcement banner</SectionTitle>
          <Input value={announcement} onChange={(e) => setAnnouncement(e.target.value)} maxLength={200} placeholder="e.g. Lunch is served on the 2nd floor 🍕" />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => act({ action: "settings.update", announcement: announcement || null }, "Announcement updated")}>Publish</Button>
            {s.settings.announcement && <Button size="sm" variant="ghost" onClick={() => { setAnnouncement(""); void act({ action: "settings.update", announcement: null }, "Announcement cleared"); }}>Clear</Button>}
          </div>
        </section>

        <section className="panel p-4">
          <SectionTitle>Partners strip</SectionTitle>
          <Label hint="one per line">Partner names</Label>
          <Textarea rows={6} value={sponsors} onChange={(e) => setSponsors(e.target.value)} />
          <Button size="sm" variant="primary" className="mt-2" onClick={() => act({ action: "settings.update", sponsors: sponsors.split("\n").map((x) => x.trim()).filter(Boolean) }, "Partners updated")}>Save partners</Button>
        </section>
      </div>

      <div className="flex flex-col gap-6">
        <section className="panel p-4">
          <SectionTitle>Export (backup)</SectionTitle>
          <p className="mb-3 text-sm text-mist">No codes or evidence files are included.</p>
          <a href="/api/admin/export?format=json" className="mb-3 inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-b from-[#b69cff] to-[#7c3aed] px-4 text-sm font-medium text-white"><Download className="size-4" /> Full event JSON</a>
          <div className="flex flex-wrap gap-2">
            {DATASETS.map((d) => (
              <a key={d} href={`/api/admin/export?format=csv&dataset=${d}`} className="rounded-md border border-line px-3 py-1.5 text-xs text-mist hover:text-silver">{d}.csv</a>
            ))}
          </div>
        </section>
        <section className="panel p-4">
          <SectionTitle>System</SectionTitle>
          <ul className="text-sm text-mist">
            <li>Evidence storage: <b className="text-silver">{s.system.storage === "supabase" ? "Supabase Storage (private bucket)" : "Database fallback (dev)"}</b></li>
            <li>Server time: <b className="text-silver">{fmtTimeSec(s.serverTime)}</b> (Europe/Stockholm)</li>
          </ul>
        </section>
        <section className="panel p-4">
          <SectionTitle>Audit log</SectionTitle>
          <ul className="max-h-[480px] divide-y divide-line overflow-y-auto text-sm">
            {s.audit.map((a) => (
              <li key={a.id} className="py-2">
                <div className="flex items-center gap-2"><span className="font-mono text-xs text-violet">{a.action}</span><span className="ml-auto text-xs tabular text-dim">{fmtTimeSec(a.at)}</span></div>
                <p className="truncate text-xs text-dim">{summarize(a.details)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function summarize(d: Record<string, unknown>) {
  return Object.entries(d).filter(([k]) => !/id$/i.test(k)).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
}
