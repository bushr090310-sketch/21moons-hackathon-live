# CLAUDE.md — 21Moons

This repo holds **two apps in one Next.js 16 (App Router) project**, sharing one Supabase project:

1. **Live game** (`/`, `/admin`, `/team`, `/vote`, `/display`, `/challenges`, `src/lib/server/**`).
   Server-only Postgres via `postgres`, custom session cookies, shared `ADMIN_PASSWORD`.
   Its tables have RLS on with **no** policies, so the Data API sees nothing. See README/RUNBOOK.
2. **21Moons CRM** (`src/app/(crm)/**`, `src/lib/crm/**`, `src/components/crm/**`): the internal
   people + projects + hackathons database. **Supabase Auth + RLS** through `@supabase/ssr`.

Don't mix the two. The CRM never uses the game's session/`db()`, and the game never uses Supabase Auth.

## CRM architecture

- **Source of truth:** `supabase/migrations/20260926120000_initial_crm_schema.sql`, which holds the schema, RLS, the storage bucket and the RPCs.
  When the product brief and the migration disagree, the migration wins. Change it only with a **new additive migration**.
- **Model:** `people` (one row per email, separate from auth) is linked to `auth.users` automatically via
  `link_auth_user()` once the email is **confirmed**. It connects to `hackathons` via `hackathon_participants`,
  to `projects` via `project_members` (many-to-many, with a per-project `team_role`), and to skills/tools/tech via
  one `tags` table with a `type` column (`person_tags`, `project_tags`). CVs live in the private bucket
  `profile-documents` at `<person_id>/<uuid>-<file>`, with metadata in `profile_documents`.
- **Roles:** `user_roles` has `admin` and `staff`. Everyone else is a participant.
  - participant: own profile, own hackathon participation, projects they are a member of.
  - staff: read/edit all people and projects, no CVs, no hard deletes.
  - admin: everything, including hackathons, CSV import, CVs, deletes and role management.
- **RPCs:** `add_project_member` (adds by email, creating a stub person), `project_team` (names and roles only),
  `import_participants` (admin, dedupes by email, never overwrites).
- **Access in the app:** everything runs as the signed-in user with the anon key, so RLS is the enforcement.
  Page guards in `src/lib/crm/auth.ts` (`requireViewer/requireStaff/requireAdmin`) exist for UX only.
  The **only** service-role use is `src/app/api/account/delete/route.ts` (GDPR self-delete).
  Never import `SUPABASE_SERVICE_ROLE_KEY` anywhere else, and never use a `NEXT_PUBLIC_` prefix for it.
- **Session:** `src/proxy.ts` (Next 16's renamed middleware) refreshes the Supabase session and sends
  signed-out users to `/login`, **only on CRM paths** (see its `matcher`). Add new CRM routes to the matcher.
- **Clients:** `src/lib/supabase/server.ts` is per request and used in Server Components and route handlers.
  `src/lib/supabase/client.ts` is the browser client, configured by `<SupabaseInit>` in `(crm)/layout.tsx`.
- **Reads** happen in Server Components. **Writes** run from client components straight to Supabase, so RLS and the
  DB CHECK constraints act as server-side validation. `src/lib/crm/form.ts` normalises input and maps DB errors to messages.
- **Option lists** in `src/lib/crm/options.ts` mirror the migration's CHECK constraints, so keep them in sync.
  Roles and tags are data. Add or approve them in the UI (`/tags`), not in code.
- **Directory** (`/people`, `/projects`, dashboard) loads rows with PostgREST embeds (`src/lib/crm/directory.ts`) and
  filters in memory. That's fine at hackathon scale. Supabase's API "Max rows" (default 1000) caps it, so move filtering
  into SQL/RPC before the CRM gets that big.
- **Nothing is hardcoded:** the current hackathon is the row with `status = 'active'`. Never hardcode IDs,
  emails or event names.

## Auth

- Email + password now. GitHub and LinkedIn (`linkedin_oidc`) are wired up. Enable them in Supabase, then set
  `AUTH_PROVIDERS=github,linkedin_oidc` to show the buttons. No code change is needed.
- Email confirmation **must stay on**. A person profile is only claimed by a confirmed email.
- `/auth/callback` handles PKCE codes (email confirmation, OAuth, password reset) and `token_hash` links.
- Admin bootstrap: the person signs up normally, then run the `user_roles` insert from `supabase/seed.sql`.

## Migrations and deploys (important)

- `npm run build` runs `scripts/migrate.mjs` first. On **Vercel production builds only**, it applies any new
  `supabase/migrations/*.sql` to the production database and records them in `schema_migrations`.
  Preview builds skip it.
- So merging a migration to the production branch applies it. **Don't also paste it into the SQL editor.**
  The migration isn't re-runnable, so if both happen the next production build fails. If you must apply it by hand, use
  `DATABASE_URL=... npm run db:migrate`, which records it.
- Migrations must be additive. Stop and ask before anything that drops or rewrites data.

## Commands

```bash
npm run lint && npm run typecheck && npm test && npm run build:app
```

`npm test` starts a local Postgres, stubs Supabase's `auth`/`storage` schemas (`tests/global-setup.ts`),
applies all migrations, and runs `tests/crm-rls.test.ts`, which covers the RLS/RPC flows the CRM UI relies on.
`tests/registration.test.ts` › "simultaneous registrations" is a known flaky game test.

## Conventions

- TypeScript strict and Tailwind 4 tokens from `globals.css` (`ink`, `line`, `mist`, `silver`, `violet`…).
  Reuse `src/components/ui.tsx` (Button, Input, Select, Badge…) and `src/components/crm/*`.
- Keep components small. Server Component for data, `"use client"` child for interaction.
- Out of scope until specified: AI extraction/search, matchmaking, marketplace, equity, betting, gamification, livestreams.
