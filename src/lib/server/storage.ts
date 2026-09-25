import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { db } from "./db";

export const EVIDENCE_BUCKET = "evidence";
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES = 3;
export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}
function serviceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
}

let client: SupabaseClient | null = null;
function supa(): SupabaseClient | null {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function storageMode(): "supabase" | "database" {
  return supa() ? "supabase" : "database";
}

/** Magic-byte check so a renamed executable can't masquerade as an image/PDF. */
export function sniffMime(head: Uint8Array): string | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export interface UploadTarget { url: string; method: "PUT"; headers: Record<string, string> }

export async function createUploadTarget(path: string, mime: string, fileId: string): Promise<UploadTarget> {
  const s = supa();
  if (!s) {
    return { url: `/api/team/uploads/${fileId}`, method: "PUT", headers: { "content-type": mime } };
  }
  const { data, error } = await s.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error("Could not create upload URL: " + (error?.message ?? "unknown"));
  return { url: data.signedUrl, method: "PUT", headers: { "content-type": mime, "x-upsert": "false" } };
}

export async function readObject(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const s = supa();
  if (!s) {
    const rows = await db()`select mime, data from local_evidence_objects where storage_path = ${path}`;
    if (!rows.length) return null;
    return { bytes: new Uint8Array(rows[0].data as Buffer), mime: rows[0].mime };
  }
  const { data, error } = await s.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type };
}

export async function removeObject(path: string): Promise<void> {
  const s = supa();
  if (!s) {
    await db()`delete from local_evidence_objects where storage_path = ${path}`;
    return;
  }
  await s.storage.from(EVIDENCE_BUCKET).remove([path]);
}

/** Short-lived URL for organizers only. Returns null in database mode (the route streams bytes instead). */
export async function signedDownloadUrl(path: string): Promise<string | null> {
  const s = supa();
  if (!s) return null;
  const { data, error } = await s.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 120);
  if (error || !data) throw new Error("Could not sign evidence URL");
  return data.signedUrl;
}

export async function storageHealth(): Promise<{ mode: string; ok: boolean; bucketPublic: boolean | null; message?: string }> {
  const s = supa();
  if (!s) return { mode: "database", ok: true, bucketPublic: false, message: "Supabase Storage not configured — using database fallback (dev only)." };
  try {
    const { data, error } = await s.storage.getBucket(EVIDENCE_BUCKET);
    if (error || !data) return { mode: "supabase", ok: false, bucketPublic: null, message: error?.message ?? "bucket missing" };
    return { mode: "supabase", ok: !data.public, bucketPublic: data.public, message: data.public ? "Evidence bucket is PUBLIC — fix immediately" : undefined };
  } catch (e) {
    return { mode: "supabase", ok: false, bucketPublic: null, message: (e as Error).message };
  }
}
