"use client";

import { FileText, ImageIcon, Paperclip, ShieldAlert, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { PublicChallenge } from "@/lib/shared/types";
import { Button, Input, Label, Modal, Textarea, api } from "@/components/ui";
import { useToast } from "@/components/toast";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX = 8 * 1024 * 1024;

export function ApplyModal({ challenge, onClose, onDone }: { challenge: PublicChallenge | null; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open={!!challenge} onClose={onClose} title={challenge ? <span>{challenge.emoji} Apply — {challenge.title}</span> : null}>
      {challenge && <ApplyForm key={challenge.id} challenge={challenge} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function ApplyForm({ challenge: c, onClose, onDone }: { challenge: PublicChallenge; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [numeric, setNumeric] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ev = c.evidence ?? {};
  const allowFiles = ev.allowFiles !== false;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!ALLOWED.includes(f.type)) { setErr(`${f.name}: only JPEG, PNG, WebP or PDF. For video, paste a link.`); continue; }
      if (f.size > MAX) { setErr(`${f.name} is larger than 8 MB. For video, paste a link instead.`); continue; }
      if (next.length >= 3) { setErr("Maximum 3 files"); break; }
      next.push(f);
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (description.trim().length < 3) return setErr("Describe what you did.");
    if (ev.requireUrl && !url.trim()) return setErr("A link is required for this challenge.");
    if (ev.numericRequired && numeric.trim() === "") return setErr(`Please fill in: ${ev.numericLabel ?? "the number"}.`);
    try {
      const fileIds: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setBusy(`Uploading ${i + 1}/${files.length}…`);
        const slot = await api<{ fileId: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
          "/api/team/uploads", { name: f.name, mime: f.type, size: f.size },
        );
        const put = await fetch(slot.upload.url, { method: "PUT", headers: slot.upload.headers, body: f });
        if (!put.ok) throw new Error(`Upload of ${f.name} failed (${put.status}). Try again.`);
        fileIds.push(slot.fileId);
      }
      setBusy("Submitting…");
      const n = numeric.trim() === "" ? null : Number(numeric.replace(",", "."));
      if (n != null && !Number.isFinite(n)) throw new Error("The number field must be a number");
      await api("/api/team/submissions", {
        challengeId: c.id, description: description.trim(), evidenceUrl: url.trim() || null, numericValue: n, fileIds,
      });
      toast.success("Application sent", "Organizers will review it shortly.");
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-mist">{c.fullDescription || c.shortDescription}</p>
      {ev.hint && <p className="rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-xs text-mist">{ev.hint}</p>}
      {c.sensitive && (
        <p className="flex gap-2 rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn">
          <ShieldAlert className="size-4 shrink-0" />
          Don&apos;t share more than needed: blur customer names, emails, card and payment details. We only need to verify it&apos;s real.
        </p>
      )}
      <label>
        <Label hint={`${description.length}/2000`}>What did you do? *</Label>
        <Textarea rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short explanation for the organizers" required />
      </label>
      <label>
        <Label hint={ev.requireUrl ? "required" : "optional"}>Link {ev.requireUrl ? "*" : ""}</Label>
        <Input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </label>
      {ev.numericLabel && (
        <label>
          <Label hint={ev.numericRequired ? "required" : "optional"}>{ev.numericLabel}{ev.numericRequired ? " *" : ""}</Label>
          <Input inputMode="decimal" value={numeric} onChange={(e) => setNumeric(e.target.value)} placeholder="0" />
        </label>
      )}
      {allowFiles && (
        <div>
          <Label hint="JPEG, PNG, WebP, PDF · max 8 MB · up to 3">Evidence files</Label>
          <div className="flex flex-col gap-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-sm">
                {f.type === "application/pdf" ? <FileText className="size-4 text-mist" /> : <ImageIcon className="size-4 text-mist" />}
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-dim">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-dim hover:text-bad" aria-label="Remove file"><Trash2 className="size-4" /></button>
              </div>
            ))}
            {files.length < 3 && (
              <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
                <Paperclip className="size-4" /> Add file
              </Button>
            )}
            <input ref={fileInput} type="file" className="hidden" accept={ALLOWED.join(",")} multiple onChange={(e) => addFiles(e.target.files)} />
          </div>
          <p className="mt-1.5 text-xs text-dim">Videos: upload to YouTube/TikTok/Drive and paste the link instead.</p>
        </div>
      )}
      {err && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={!!busy}>{busy ?? "Submit application"}</Button>
      </div>
    </form>
  );
}
