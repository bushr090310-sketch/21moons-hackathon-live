"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Select, cx } from "@/components/ui";
import { Card } from "@/components/crm/page-header";
import { buildRows, guessMapping, IMPORT_FIELDS, parseCsv, type ImportField, type ImportRow } from "@/lib/crm/csv";
import { supabase } from "@/lib/supabase/client";

type Hackathon = { id: string; name: string; status: string };
type Result = { out_row: number; out_email: string | null; out_result: "created" | "existing" | "error"; out_message: string | null };

const CHUNK = 200;

export function ImportTool({ hackathons }: { hackathons: Hackathon[] }) {
  const [hackathonId, setHackathonId] = useState(hackathons.find((h) => h.status === "active")?.id ?? hackathons[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<ImportField, number> | null>(null);
  const [approvalCol, setApprovalCol] = useState(-1);
  const [onlyApproved, setOnlyApproved] = useState(true);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<(Result & { line: number })[] | null>(null);

  async function onFile(f: File | undefined) {
    setError(null);
    setResults(null);
    if (!f) return;
    const rows = parseCsv(await f.text());
    if (rows.length < 2) {
      setError("The file has no data rows.");
      return;
    }
    const [h, ...d] = rows;
    setFileName(f.name);
    setHeader(h);
    setData(d);
    setMapping(guessMapping(h));
    setApprovalCol(h.findIndex((x) => x.trim().toLowerCase() === "approval_status"));
    // Which emails already exist in the CRM (staff can read people).
    const emails = [...new Set(d.flatMap((r) => r.map((c) => c.trim().toLowerCase())).filter((c) => c.includes("@")))];
    const found = new Set<string>();
    for (let i = 0; i < emails.length; i += 300) {
      const { data: ppl } = await supabase().from("people").select("email").in("email", emails.slice(i, i + 300));
      ppl?.forEach((p: { email: string }) => found.add(p.email));
    }
    setExisting(found);
  }

  const rows: ImportRow[] = useMemo(() => {
    if (!mapping) return [];
    const all = buildRows(data, mapping);
    if (approvalCol < 0 || !onlyApproved) return all;
    return all.filter((_, i) => (data[i][approvalCol] ?? "").trim().toLowerCase() === "approved");
  }, [data, mapping, approvalCol, onlyApproved]);

  const valid = rows.filter((r) => r.problems.length === 0 && r.duplicateOf === null);
  const invalid = rows.filter((r) => r.problems.length > 0);
  const dups = rows.filter((r) => r.problems.length === 0 && r.duplicateOf !== null);
  const already = valid.filter((r) => existing.has(r.email));

  async function runImport() {
    if (!hackathonId || valid.length === 0) return;
    setBusy(true);
    setError(null);
    const out: (Result & { line: number })[] = [];
    try {
      for (let i = 0; i < valid.length; i += CHUNK) {
        const chunk = valid.slice(i, i + CHUNK);
        const payload = chunk.map((r) => ({ email: r.email, full_name: r.full_name, phone: r.phone, external_ref: r.external_ref }));
        const { data: res, error } = await supabase().rpc("import_participants", { p_hackathon_id: hackathonId, p_rows: payload });
        if (error) throw error;
        (res as Result[]).forEach((r) => out.push({ ...r, line: chunk[r.out_row - 1]?.line ?? 0 }));
      }
      setResults(out);
    } catch (e) {
      setError(`Import stopped: ${e instanceof Error ? e.message : String(e)}. ${out.length} rows were processed before the error; re-running is safe (rows are matched by email).`);
      setResults(out);
    } finally {
      setBusy(false);
    }
  }

  if (hackathons.length === 0) {
    return <p className="text-mist">No hackathons yet. <Link className="text-violet underline" href="/hackathons">Create one first</Link>.</p>;
  }

  const count = (k: Result["out_result"]) => results?.filter((r) => r.out_result === k).length ?? 0;

  return (
    <div className="space-y-4">
      <Card title="1 · File & hackathon">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-mist">Hackathon</span>
            <Select value={hackathonId} onChange={(e) => setHackathonId(e.target.value)}>
              {hackathons.map((h) => (
                <option key={h.id} value={h.id}>{h.name} ({h.status})</option>
              ))}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-mist">CSV file</span>
            <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm text-mist file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-white/[0.05] file:px-3 file:py-2 file:text-silver" />
          </label>
        </div>
        {fileName && <p className="mt-3 text-xs text-dim">{fileName}: {data.length} data rows, {header.length} columns</p>}
      </Card>

      {mapping && (
        <Card title="2 · Column mapping">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key} className="block text-sm">
                <span className="mb-1 block text-mist">{f.label}</span>
                <Select value={mapping[f.key]} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}>
                  <option value={-1}>— not in file —</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>{h || `(column ${i + 1})`}</option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-dim">Full name is used if mapped; otherwise first + last name are combined.</p>
          {approvalCol >= 0 && (
            <label className="mt-3 flex items-center gap-2 text-sm text-mist">
              <input type="checkbox" checked={onlyApproved} onChange={(e) => setOnlyApproved(e.target.checked)} />
              Only import rows where <code>approval_status</code> is <b>approved</b> ({data.length - rows.length} rows skipped)
            </label>
          )}
        </Card>
      )}

      {mapping && (
        <Card
          title="3 · Preview"
          actions={
            <Button variant="primary" size="sm" loading={busy} disabled={!hackathonId || mapping.email < 0 || valid.length === 0} onClick={runImport}>
              Import {valid.length} rows
            </Button>
          }
        >
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Badge tone="ok">{valid.length - already.length} new</Badge>
            <Badge tone="cyan">{already.length} already in CRM (linked, not overwritten)</Badge>
            <Badge tone="warn">{dups.length} duplicate in file (skipped)</Badge>
            <Badge tone="bad">{invalid.length} invalid (skipped)</Badge>
          </div>
          {mapping.email < 0 && <p className="mb-3 text-sm text-bad">Map the email column to continue.</p>}
          <div className="max-h-[480px] overflow-auto rounded-lg border border-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-ink-2 text-xs uppercase tracking-wider text-dim">
                <tr><th className="px-3 py-2">Line</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">External ID</th><th className="px-3 py-2">Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className={cx("border-t border-line", r.problems.length > 0 && "bg-bad/5", r.duplicateOf !== null && "bg-warn/5")}>
                    <td className="px-3 py-1.5 text-dim">{r.line}</td>
                    <td className="px-3 py-1.5">{r.email || <span className="text-dim">—</span>}</td>
                    <td className="px-3 py-1.5">{r.full_name}</td>
                    <td className="px-3 py-1.5 text-mist">{r.phone}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-dim">{r.external_ref}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {r.problems.length > 0 ? <span className="text-bad">{r.problems.join(", ")}</span>
                        : r.duplicateOf !== null ? <span className="text-warn">duplicate of line {r.duplicateOf}</span>
                        : existing.has(r.email) ? <span className="text-cyan">exists</span>
                        : <span className="text-ok">new</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {error && <p className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}

      {results && (
        <Card title="4 · Result">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge tone="ok">{count("created")} created</Badge>
            <Badge tone="cyan">{count("existing")} existing → added to hackathon</Badge>
            <Badge tone="bad">{count("error")} failed</Badge>
          </div>
          {count("error") > 0 && (
            <ul className="space-y-1 text-sm">
              {results.filter((r) => r.out_result === "error").map((r) => (
                <li key={r.line} className="text-bad">Line {r.line} ({r.out_email ?? "no email"}): {r.out_message}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-mist">
            <Link href={`/hackathons/${hackathonId}`} className="text-violet underline">Open the hackathon</Link> to see participants.
          </p>
        </Card>
      )}
    </div>
  );
}
