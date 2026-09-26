"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Trash2 } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { Card } from "@/components/crm/page-header";
import { supabase } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/crm/form";
import type { ProfileDocument } from "@/lib/crm/types";

const BUCKET = "profile-documents"; // private bucket; owner + admin only (see migration §11)
const KINDS = [
  { value: "cv", label: "CV" },
  { value: "linkedin_pdf", label: "LinkedIn “Save to PDF”" },
  { value: "other", label: "Other" },
];
const MAX = 10 * 1024 * 1024;
const TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

export function Documents({ personId, documents }: { personId: string; documents: ProfileDocument[] }) {
  const router = useRouter();
  const [kind, setKind] = useState("cv");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) return setError("Upload a PDF or DOCX file.");
    if (file.size > MAX) return setError("Max file size is 10 MB.");
    setBusy(true);
    const sb = supabase();
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
    const path = `${personId}/${crypto.randomUUID()}-${safe}`;
    try {
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
      const { error } = await sb.from("profile_documents").insert({
        person_id: personId, kind, storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size,
      });
      if (error) {
        await sb.storage.from(BUCKET).remove([path]);
        throw error;
      }
      router.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function open(doc: ProfileDocument) {
    const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
    if (error) return setError(friendlyError(error));
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function remove(doc: ProfileDocument) {
    if (!confirm(`Delete ${doc.file_name}?`)) return;
    const sb = supabase();
    const { error } = await sb.storage.from(BUCKET).remove([doc.storage_path]);
    if (error) return setError(friendlyError(error));
    const del = await sb.from("profile_documents").delete().eq("id", doc.id);
    if (del.error) return setError(friendlyError(del.error));
    router.refresh();
  }

  return (
    <Card title="CV / profile documents (private)">
      <p className="mb-3 text-sm text-mist">
        Upload your CV or LinkedIn profile PDF (LinkedIn → your profile → More → Save to PDF). Only you and 21Moons admins can open it.
      </p>
      {documents.length > 0 && (
        <ul className="mb-3 divide-y divide-line rounded-lg border border-line">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileText className="size-4 text-dim" />
              <button type="button" onClick={() => open(d)} className="truncate text-left text-silver hover:underline">{d.file_name}</button>
              <span className="text-xs text-dim">{KINDS.find((k) => k.value === d.kind)?.label} · {new Date(d.uploaded_at).toLocaleDateString()}</span>
              <button type="button" onClick={() => remove(d)} className="ml-auto text-dim hover:text-bad" aria-label="Delete file"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="!h-9 w-auto">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </Select>
        <label>
          <input type="file" accept=".pdf,.docx,application/pdf" className="hidden" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          <span className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-line-strong bg-white/[0.04] px-3 text-sm text-silver hover:bg-white/[0.08]">
            {busy ? "Uploading…" : "Upload PDF / DOCX"}
          </span>
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </Card>
  );
}

export function DeleteAccount() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (!confirm("Permanently delete your 21Moons profile, uploaded files and login? Projects you were part of remain, without you. This cannot be undone.")) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/delete", { method: "POST" });
    if (res.ok) {
      window.location.href = "/login";
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Could not delete your account.");
    setBusy(false);
  }
  return (
    <Card title="Delete my data">
      <p className="mb-3 text-sm text-mist">Deletes your profile, skills, hackathon participation, project memberships, uploaded files and your login.</p>
      <Button type="button" variant="danger" loading={busy} onClick={run}>Delete my profile and account</Button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </Card>
  );
}
