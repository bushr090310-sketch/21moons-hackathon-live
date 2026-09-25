import type { Tx } from "./db";

export async function audit(tx: Tx, action: string, details: Record<string, unknown> = {}) {
  await tx`insert into admin_audit_log (action, details) values (${action}, ${tx.json(details as never)})`;
}
