import { AppError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { requireTeam } from "@/lib/server/session";
import { MAX_FILE_BYTES, storageMode } from "@/lib/server/storage";
import { storeLocalUpload } from "@/lib/server/submissions";

// Database-mode upload target (used only when Supabase Storage is not configured).
export const PUT = route<{ params: Promise<{ fileId: string }> }>(async (req, ctx) => {
  if (storageMode() !== "database") throw new AppError(404, "Not found");
  const team = await requireTeam(req);
  const { fileId } = await ctx.params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_FILE_BYTES) throw new AppError(413, "File too large");
  const bytes = new Uint8Array(await req.arrayBuffer());
  await storeLocalUpload(team.teamId, fileId, bytes);
  return { ok: true };
});
