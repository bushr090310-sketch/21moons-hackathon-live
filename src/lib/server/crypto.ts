import crypto from "node:crypto";

// Unambiguous alphabet: no 0/O, 1/I/L.
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** 12 chars ≈ 59 bits, shown as XXXX-XXXX-XXXX. */
export function generateTeamCode(): string {
  const c = randomCode(12);
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** 7 chars ≈ 34 bits, shown as XXX-XXXX. Throttled at login. */
export function generateVoteCode(): string {
  const c = randomCode(7);
  return `${c.slice(0, 3)}-${c.slice(3)}`;
}

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (32+ random characters) in production");
  }
  return "dev-only-insecure-session-secret-change-me";
}

function codePepper(): string {
  return process.env.CODE_PEPPER || sessionSecret();
}

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashTeamCode(code: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(normalizeCode(code), salt, 32, SCRYPT);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyTeamCode(code: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = crypto.scryptSync(normalizeCode(code), Buffer.from(saltB64, "base64url"), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

/** Deterministic keyed hash so a voting code can be looked up without storing it. */
export function hashVoteCode(code: string): string {
  return crypto.createHmac("sha256", codePepper()).update("vote:" + normalizeCode(code)).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// Signed tokens (session cookies)
// ---------------------------------------------------------------------------
export function sign(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verify<T = Record<string, unknown>>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp?: number };
    if (typeof payload.exp === "number" && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function adminPasswordFingerprint(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return crypto.createHmac("sha256", sessionSecret()).update("admin-pw:" + pw).digest("base64url").slice(0, 16);
}
