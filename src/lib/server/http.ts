import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";

export function json(data: unknown, init?: number | ResponseInit): NextResponse {
  const base: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  const res = NextResponse.json(data, base);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients / same-origin fetch without Origin
  try {
    const o = new URL(origin);
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    return !!host && o.host === host;
  } catch {
    return false;
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response | unknown>;

export function route<C = unknown>(fn: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
        return json({ error: "Cross-origin request blocked" }, 403);
      }
      const out = await fn(req, ctx);
      return out instanceof Response ? out : json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) return json({ error: e.message, details: e.details ?? null }, e.status);
      if (e instanceof ZodError) {
        const first = e.issues[0];
        const where = first?.path?.length ? `${first.path.join(".")}: ` : "";
        return json({ error: `Invalid input — ${where}${first?.message ?? "check the form"}` }, 400);
      }
      if (e instanceof SyntaxError) return json({ error: "Invalid JSON body" }, 400);
      console.error("[api error]", e);
      return json({ error: "Something went wrong on the server. Try again." }, 500);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 64 * 1024) throw new AppError(413, "Request too large");
  return text ? JSON.parse(text) : {};
}
