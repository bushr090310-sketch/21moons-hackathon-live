export class AppError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(400, m, d);
export const unauthorized = (m = "Not signed in") => new AppError(401, m);
export const forbidden = (m = "Not allowed") => new AppError(403, m);
export const notFound = (m = "Not found") => new AppError(404, m);
export const conflict = (m: string, d?: unknown) => new AppError(409, m, d);

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint_name?: string };
  return err?.code === "23505" && (!constraint || err.constraint_name === constraint);
}
