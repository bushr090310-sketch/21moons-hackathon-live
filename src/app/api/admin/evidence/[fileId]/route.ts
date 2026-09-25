import { db } from "@/lib/server/db";
import { notFound } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { readObject, signedDownloadUrl } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

// Organizer-only evidence access. Supabase mode: redirect to a 2-minute signed URL.
export const GET = route<{ params: Promise<{ fileId: string }> }>(async (req, ctx) => {
  requireAdmin(req);
  const { fileId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound();
  const [f] = await db()`select storage_path, mime from submission_files where id = ${fileId} and submission_id is not null`;
  if (!f) throw notFound("File not found");
  const signed = await signedDownloadUrl(f.storage_path);
  if (signed) return Response.redirect(signed, 302);
  const obj = await readObject(f.storage_path);
  if (!obj) throw notFound("File not found");
  return new Response(Buffer.from(obj.bytes), {
    headers: {
      "Content-Type": f.mime,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
    },
  });
});
