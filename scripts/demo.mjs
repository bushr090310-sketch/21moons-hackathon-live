#!/usr/bin/env node
// Seed or remove the 3 demo teams through the admin API of a running instance.
//   APP_URL=https://your-app.vercel.app ADMIN_PASSWORD=... node scripts/demo.mjs seed|remove
const cmd = process.argv[2];
const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const password = process.env.ADMIN_PASSWORD;
if (!["seed", "remove"].includes(cmd) || !password) {
  console.error("Usage: APP_URL=... ADMIN_PASSWORD=... node scripts/demo.mjs seed|remove");
  process.exit(1);
}
const login = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
if (!login.ok) { console.error("Login failed:", (await login.json()).error); process.exit(1); }
const cookie = login.headers.get("set-cookie").split(";")[0];
const res = await fetch(`${base}/api/admin/action`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ action: cmd === "seed" ? "demo.seed" : "demo.remove" }),
});
const body = await res.json();
if (!res.ok) { console.error(body.error); process.exit(1); }
if (cmd === "seed") {
  for (const t of body.result ?? []) {
    console.log(`\nTEAM: ${t.team.name}\nTEAM LOGIN CODE: ${t.accessCode}\nVOTING CODES:`);
    for (const p of t.participants) console.log(`  ${p.name} — ${p.voteCode}`);
  }
  if (!body.result?.length) console.log("Demo teams already exist.");
} else {
  console.log(`Removed ${body.result.removed} demo team(s).`);
}
