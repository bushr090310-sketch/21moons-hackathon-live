import { db, withTx, type Tx } from "./db";
import { badRequest, conflict, isUniqueViolation, notFound } from "./errors";
import { audit } from "./audit";
import { generateTeamCode, generateVoteCode, hashTeamCode, hashVoteCode, verifyTeamCode } from "./crypto";
import { assertNotThrottled, recordFailure } from "./ratelimit";

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40) || "team";
}

async function uniqueTeamSlug(tx: Tx, name: string) {
  const root = slugify(name);
  for (let i = 0; i < 100; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    const r = await tx`select 1 from teams where slug = ${slug}`;
    if (!r.length) return slug;
  }
  return `${root}-${Date.now()}`;
}

export function cleanNames(raw: string[] | string): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(/[\n,;]+/);
  const out: string[] = [];
  for (const n of list) {
    const v = n.replace(/\s+/g, " ").trim();
    if (!v) continue;
    if (v.length > 80) throw badRequest(`Name too long: ${v.slice(0, 20)}…`);
    out.push(v);
  }
  if (out.length > 20) throw badRequest("Max 20 participants per team");
  return out;
}

async function insertParticipant(tx: Tx, teamId: string, name: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateVoteCode();
    try {
      const [p] = await tx`
        insert into participants (team_id, name, vote_code_hash) values (${teamId}, ${name}, ${hashVoteCode(code)})
        returning id, name`;
      return { id: p.id as string, name: p.name as string, voteCode: code };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("Could not generate a unique voting code");
}

export interface TeamCard {
  team: { id: string; name: string };
  accessCode?: string;
  participants: { id: string; name: string; voteCode: string }[];
}

export async function createTeam(input: { name: string; description?: string | null; participants: string[] | string; isDemo?: boolean }): Promise<TeamCard> {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) throw badRequest("Team name is required (max 60 characters)");
  const names = cleanNames(input.participants);
  const accessCode = generateTeamCode();
  return withTx(async (tx) => {
    const [dupe] = await tx`select 1 from teams where lower(name) = lower(${name}) and active`;
    if (dupe) throw conflict(`A team called "${name}" already exists`);
    const slug = await uniqueTeamSlug(tx, name);
    const [team] = await tx`
      insert into teams (name, slug, description, is_demo) values (${name}, ${slug}, ${input.description?.trim() || null}, ${!!input.isDemo})
      returning id, name`;
    await tx`insert into team_secrets (team_id, access_code_hash) values (${team.id}, ${hashTeamCode(accessCode)})`;
    const participants = [];
    for (const n of names) participants.push(await insertParticipant(tx, team.id, n));
    await audit(tx, "team.created", { teamId: team.id, name, participants: names.length, demo: !!input.isDemo });
    return { team: { id: team.id, name: team.name }, accessCode, participants };
  });
}

export async function updateTeam(id: string, input: { name?: string; description?: string | null; active?: boolean }) {
  return withTx(async (tx) => {
    const [t] = await tx`select * from teams where id = ${id} for update`;
    if (!t) throw notFound("Team not found");
    const name = input.name?.replace(/\s+/g, " ").trim() ?? t.name;
    if (!name || name.length > 60) throw badRequest("Team name is required (max 60 characters)");
    if (name.toLowerCase() !== t.name.toLowerCase()) {
      const [dupe] = await tx`select 1 from teams where lower(name) = lower(${name}) and active and id <> ${id}`;
      if (dupe) throw conflict(`A team called "${name}" already exists`);
    }
    const active = input.active ?? t.active;
    await tx`
      update teams set name = ${name}, description = ${input.description === undefined ? t.description : input.description?.trim() || null},
        active = ${active}, updated_at = now() where id = ${id}`;
    if (active !== t.active) {
      // Archiving a team logs it out.
      await tx`update team_secrets set session_version = session_version + 1 where team_id = ${id}`;
    }
    await audit(tx, active !== t.active ? (active ? "team.restored" : "team.archived") : "team.updated", { teamId: id, name });
  });
}

export async function addParticipants(teamId: string, raw: string[] | string) {
  const names = cleanNames(raw);
  if (!names.length) throw badRequest("Enter at least one name");
  return withTx(async (tx) => {
    const [t] = await tx`select id, name from teams where id = ${teamId}`;
    if (!t) throw notFound("Team not found");
    const out = [];
    for (const n of names) out.push(await insertParticipant(tx, teamId, n));
    await audit(tx, "participants.added", { teamId, team: t.name, count: out.length });
    return { team: { id: t.id as string, name: t.name as string }, participants: out } satisfies TeamCard;
  });
}

export async function renameParticipant(id: string, name: string) {
  const v = name.replace(/\s+/g, " ").trim();
  if (!v || v.length > 80) throw badRequest("Name is required");
  const r = await db()`update participants set name = ${v} where id = ${id} returning id`;
  if (!r.length) throw notFound("Participant not found");
}

export async function removeParticipant(id: string) {
  return withTx(async (tx) => {
    const [p] = await tx`select p.id, p.name, t.name as team from participants p join teams t on t.id = p.team_id where p.id = ${id}`;
    if (!p) throw notFound("Participant not found");
    const [v] = await tx`select 1 from votes where participant_id = ${id}`;
    await tx`delete from participants where id = ${id}`;
    await audit(tx, "participant.removed", { name: p.name, team: p.team, hadVoted: !!v });
  });
}

export async function regenerateTeamCode(teamId: string) {
  const code = generateTeamCode();
  return withTx(async (tx) => {
    const [t] = await tx`select id, name from teams where id = ${teamId}`;
    if (!t) throw notFound("Team not found");
    await tx`
      insert into team_secrets (team_id, access_code_hash) values (${teamId}, ${hashTeamCode(code)})
      on conflict (team_id) do update set access_code_hash = excluded.access_code_hash,
        session_version = team_secrets.session_version + 1, updated_at = now()`;
    await audit(tx, "team.code_regenerated", { teamId, team: t.name });
    return { team: { id: t.id as string, name: t.name as string }, accessCode: code, participants: [] } satisfies TeamCard;
  });
}

export async function regenerateVoteCodes(opts: { teamId?: string; participantId?: string; all?: boolean }) {
  return withTx(async (tx) => {
    const rows = opts.participantId
      ? await tx`select p.id, p.name, p.team_id, t.name as team from participants p join teams t on t.id = p.team_id where p.id = ${opts.participantId}`
      : opts.teamId
        ? await tx`select p.id, p.name, p.team_id, t.name as team from participants p join teams t on t.id = p.team_id where p.team_id = ${opts.teamId} order by p.created_at`
        : opts.all
          ? await tx`select p.id, p.name, p.team_id, t.name as team from participants p join teams t on t.id = p.team_id where t.active order by t.name, p.created_at`
          : [];
    if (!rows.length) throw notFound("No participants found");
    const out: { teamId: string; team: string; id: string; name: string; voteCode: string }[] = [];
    for (const r of rows) {
      for (let attempt = 0; ; attempt++) {
        const code = generateVoteCode();
        try {
          await tx`update participants set vote_code_hash = ${hashVoteCode(code)} where id = ${r.id}`;
          out.push({ teamId: r.team_id, team: r.team, id: r.id, name: r.name, voteCode: code });
          break;
        } catch (e) {
          if (!isUniqueViolation(e) || attempt > 4) throw e;
        }
      }
    }
    await audit(tx, "vote_codes.regenerated", { count: out.length, teamId: opts.teamId ?? null, participantId: opts.participantId ?? null });
    return out;
  });
}

// ---------------------------------------------------------------------------
// Team login
// ---------------------------------------------------------------------------
export async function listLoginTeams() {
  const rows = await db()`select id, name from teams where active order by lower(name)`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
}

export async function loginTeam(teamId: string, code: string, ip: string) {
  await assertNotThrottled("team-login", ip, 15);
  await assertNotThrottled("team-login-team", teamId, 40);
  const [row] = await db()`
    select t.id, t.name, s.access_code_hash, s.session_version from teams t join team_secrets s on s.team_id = t.id
    where t.id = ${teamId} and t.active`;
  if (!row || !verifyTeamCode(code, row.access_code_hash)) {
    await recordFailure("team-login", ip);
    if (row) await recordFailure("team-login-team", teamId);
    throw badRequest("Wrong team code. Check the code card from the organizers.");
  }
  return { teamId: row.id as string, name: row.name as string, sessionVersion: row.session_version as number };
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------
export const DEMO_TEAMS = [
  { name: "Lunar Labs", participants: ["Ada Demo", "Ben Demo", "Cleo Demo"] },
  { name: "Orbit AI", participants: ["Dan Demo", "Eva Demo"] },
  { name: "Apollo Works", participants: ["Finn Demo", "Gina Demo", "Hugo Demo"] },
];

export async function seedDemoTeams() {
  const cards: TeamCard[] = [];
  for (const t of DEMO_TEAMS) {
    const [exists] = await db()`select 1 from teams where lower(name) = lower(${t.name}) and active`;
    if (exists) continue;
    cards.push(await createTeam({ ...t, description: "Demo team — remove before the event", isDemo: true }));
  }
  return cards;
}

/** Hard-deletes demo teams and ALL their data. Only ever touches teams flagged is_demo. */
export async function removeDemoTeams() {
  return withTx(async (tx) => {
    const demo = await tx`select id, name from teams where is_demo`;
    if (!demo.length) return { removed: 0 };
    const ids = demo.map((d) => d.id as string);
    await tx`select set_config('app.allow_demo_purge', 'on', true)`;
    await tx`delete from score_ledger where team_id = any(${ids}::uuid[]) and reverses_id is not null`;
    await tx`delete from score_ledger where team_id = any(${ids}::uuid[])`;
    await tx`delete from teams where id = any(${ids}::uuid[])`;
    await tx`select set_config('app.allow_demo_purge', 'off', true)`;
    await audit(tx, "demo.removed", { teams: demo.map((d) => d.name) });
    return { removed: demo.length };
  });
}
