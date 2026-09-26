// Exercises the CRM migration's RLS + RPCs the way the app uses them, against real
// Postgres with the Supabase auth/storage stubs from global-setup.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

type Tx = postgres.TransactionSql;
async function as<T>(uid: string | null, email: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T;
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${uid ?? ""}, true),
                      set_config('request.jwt.claims', ${JSON.stringify(uid ? { sub: uid, email } : {})}, true)`;
      await tx.unsafe(`set local role ${uid ? "authenticated" : "anon"}`);
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out!;
}
class Rollback extends Error {}

async function user(email: string, confirmed = true) {
  const [u] = await sql`insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
    values (${email}, ${confirmed ? sql`now()` : null}, ${sql.json({ full_name: email.split("@")[0] })}) returning id`;
  return u.id as string;
}

let admin: string, staff: string, alice: string, bob: string, hackathon: string;

beforeAll(async () => {
  await sql`truncate public.people, public.hackathons, public.projects, public.tags, public.user_roles cascade`;
  await sql`delete from auth.users`;
  admin = await user("admin@21moons.test");
  staff = await user("staff@21moons.test");
  alice = await user("alice@example.com");
  bob = await user("bob@example.com");
  await sql`insert into public.user_roles (user_id, role) values (${admin}, 'admin'), (${staff}, 'staff')`;
  [{ id: hackathon }] = await sql`insert into public.hackathons (slug, name, status) values ('t-live', 'Test Live', 'active') returning id`;
  // Alice and Bob build a project together (committed so later tests can see it).
  const [{ id: pid }] = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${alice}, true), set_config('request.jwt.claims', ${JSON.stringify({ sub: alice, email: "alice@example.com" })}, true)`;
    await tx`set local role authenticated`;
    return tx`insert into public.projects (name, origin_hackathon_id) values ('Moonshot', ${hackathon}) returning id`;
  });
  projectId = pid;
});
let projectId: string;

afterAll(async () => {
  await sql.end();
});

describe("CRM RLS", () => {
  it("links confirmed signups to a person; unconfirmed emails never claim a profile", async () => {
    const [p] = await sql`select auth_user_id, full_name, source from public.people where email = 'alice@example.com'`;
    expect(p).toMatchObject({ auth_user_id: alice, full_name: "alice", source: "self" });
    await sql`insert into public.people (email, source) values ('carol@example.com', 'import')`;
    const carol = await user("carol@example.com", false);
    expect((await sql`select auth_user_id from public.people where email = 'carol@example.com'`)[0].auth_user_id).toBeNull();
    await sql`update auth.users set email_confirmed_at = now() where id = ${carol}`;
    expect((await sql`select auth_user_id from public.people where email = 'carol@example.com'`)[0].auth_user_id).toBe(carol);
  });

  it("participants read/update only their own profile and cannot change email", async () => {
    const rows = await as(alice, "alice@example.com", (tx) => tx`select email from public.people`);
    expect(rows.map((r) => r.email)).toEqual(["alice@example.com"]);
    const upd = await as(alice, "alice@example.com", (tx) =>
      tx`update public.people set headline = 'x', privacy_consent_at = now(), sharing_opt_ins = '{investors}' where email = 'bob@example.com' returning id`);
    expect(upd).toHaveLength(0);
    await expect(as(alice, "alice@example.com", (tx) => tx`update public.people set email = 'evil@example.com' where auth_user_id = ${alice}`)).rejects.toThrow(/staff/);
    const own = await as(alice, "alice@example.com", (tx) =>
      tx`update public.people set headline = 'Dev', open_to = '{projects}', privacy_consent_at = now() where auth_user_id = ${alice} returning id`);
    expect(own).toHaveLength(1);
  });

  it("project creator becomes lead; add_project_member invites by email; team visible via project_team only", async () => {
    const team0 = await sql`select pm.is_lead, p.email from public.project_members pm join public.people p on p.id = pm.person_id where project_id = ${projectId}`;
    expect(team0).toEqual([{ is_lead: true, email: "alice@example.com" }]);
    const team = await as(alice, "alice@example.com", async (tx) => {
      await tx`select public.add_project_member(${projectId}, 'Bob@Example.com', 'designer', null)`;
      await tx`select public.add_project_member(${projectId}, 'dave@example.com', 'developer', 'Dave')`;
      await tx`insert into public.tags (type, name) values ('technology', 'Rust')`;
      const [{ id: tag }] = await tx`select id from public.tags where name = 'Rust'`;
      await tx`insert into public.project_tags (project_id, tag_id) values (${projectId}, ${tag}) on conflict do nothing`;
      return tx`select full_name, team_role from public.project_team(${projectId})`;
    });
    expect(team.map((t) => t.team_role).sort()).toEqual(["designer", "developer", "founder"]);
  });

  it("non-members cannot see or edit a project; staff can, admin-only import", async () => {
    const seen = await as(bob, "bob@example.com", (tx) => tx`select id from public.projects`);
    expect(seen).toHaveLength(0);
    await expect(as(bob, "bob@example.com", (tx) => tx`select public.add_project_member(${projectId}, 'x@y.io', 'other', null)`)).rejects.toThrow(/not allowed/);
    const staffSees = await as(staff, "staff@21moons.test", (tx) => tx`select id from public.projects`);
    expect(staffSees).toHaveLength(1);
    await expect(as(staff, "staff@21moons.test", (tx) => tx`select * from public.import_participants(${hackathon}, '[]'::jsonb)`)).rejects.toThrow(/admin only/);
  });

  it("import_participants dedupes by email, never overwrites, reports bad rows", async () => {
    const res = await as(admin, "admin@21moons.test", (tx) => tx`
      select * from public.import_participants(${hackathon}, ${sql.json([
        { email: "ALICE@example.com", full_name: "Overwritten?" },
        { email: "new@example.com", full_name: "New Person", external_ref: "gst-1" },
        { email: "broken" },
      ])})`);
    expect(res.map((r) => r.out_result)).toEqual(["existing", "created", "error"]);
    const [a] = await sql`select full_name from public.people where email = 'alice@example.com'`;
    expect(a.full_name).toBe("alice");
  });

  it("participants can join an active hackathon themselves; the overview view is staff-only", async () => {
    const joined = await as(bob, "bob@example.com", async (tx) => {
      const [{ id }] = await tx`select public.my_person_id() as id`;
      return tx`insert into public.hackathon_participants (hackathon_id, person_id, source) values (${hackathon}, ${id}, 'self') returning person_id`;
    });
    expect(joined).toHaveLength(1);
    const asBob = await as(bob, "bob@example.com", (tx) => tx`select * from public.hackathon_participant_overview`);
    expect(asBob).toHaveLength(0);
  });

  it("CV rows and files are owner/admin only (staff cannot see them)", async () => {
    const [{ id: pid }] = await sql`select id from public.people where email = 'alice@example.com'`;
    await as(alice, "alice@example.com", (tx) => tx`insert into storage.objects (bucket_id, name) values ('profile-documents', ${pid + "/a-cv.pdf"})`);
    await expect(
      as(bob, "bob@example.com", (tx) => tx`insert into storage.objects (bucket_id, name) values ('profile-documents', ${pid + "/evil.pdf"})`),
    ).rejects.toThrow(/row-level security/);
    await sql`insert into public.profile_documents (person_id, storage_path, file_name) values (${pid}, ${pid + "/cv.pdf"}, 'cv.pdf')`;
    expect(await as(staff, "staff@21moons.test", (tx) => tx`select id from public.profile_documents`)).toHaveLength(0);
    expect(await as(admin, "admin@21moons.test", (tx) => tx`select id from public.profile_documents`)).toHaveLength(1);
    expect(await as(alice, "alice@example.com", (tx) => tx`select id from public.profile_documents`)).toHaveLength(1);
  });

  it("anon sees nothing", async () => {
    const rows = await as(null, null, (tx) => tx`select id from public.people`).catch((e) => e);
    expect(Array.isArray(rows) ? rows.length : 0).toBe(0);
  });

  it("the FK names used by the people directory embed exist", async () => {
    const fks = await sql`select conname from pg_constraint where conrelid = 'public.people'::regclass and contype = 'f'`;
    expect(fks.map((f) => f.conname)).toEqual(expect.arrayContaining(["people_primary_role_id_fkey", "people_secondary_role_id_fkey"]));
  });
});
