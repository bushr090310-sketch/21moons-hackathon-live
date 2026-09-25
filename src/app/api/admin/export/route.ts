import { badRequest } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/session";
import { EXPORT_DATASETS, exportCsv, exportEvent } from "@/lib/server/export";
import { audit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  requireAdmin(req);
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await audit(db(), "data.exported", { format, dataset: url.searchParams.get("dataset") });
  if (format === "csv") {
    const dataset = url.searchParams.get("dataset") as (typeof EXPORT_DATASETS)[number];
    if (!EXPORT_DATASETS.includes(dataset)) throw badRequest("Unknown dataset");
    return new Response(await exportCsv(dataset), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="21moons-${dataset}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const res = json(await exportEvent());
  res.headers.set("Content-Disposition", `attachment; filename="21moons-event-${stamp}.json"`);
  return res;
});
