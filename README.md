# 21MOONS Hackathon Live

The live game control system for the 21MOONS Hackathon (Malmö, 26 September 2026).
It covers the live leaderboard, projector mode, challenge drops, team applications with private
evidence, the organizer inbox, the score ledger, the leaderboard freeze and final reveal,
People's Choice voting, and final awards.

**Organizers: read [RUNBOOK.md](./RUNBOOK.md).**

## Stack

- Next.js 16 (App Router), TypeScript and Tailwind 4. Animation uses framer-motion; icons come from lucide-react.
- Postgres (Supabase), accessed server-side only through `postgres`. All tables have RLS enabled with
  no policies for `anon` or `authenticated`, so the Supabase Data API exposes nothing.
- Supabase Storage holds evidence in a private `evidence` bucket. The browser uploads through signed upload URLs
  (this avoids Vercel's body-size limit). The server then verifies magic bytes and size.
- Supabase Realtime watches the data-free `live_signals` table as an invalidation signal. Every client
  also polls, so the app keeps working without Realtime.

## Deploy (Vercel + Supabase)

1. In Vercel, go to **Add New → Project** and import this GitHub repo.
2. In the project, open **Storage → Supabase → Create** (or connect an existing *dedicated* project).
   This injects `POSTGRES_URL*`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Add two environment variables: `ADMIN_PASSWORD` and `SESSION_SECRET`.
   Generate the secret with `openssl rand -base64 32`.
4. Redeploy. `npm run build` applies `supabase/migrations/*.sql` (schema, private bucket, RLS, the
   Realtime publication and the seeded challenges) and then builds. The migrations are idempotent and each runs once.

Check that `/api/health` returns `{"ok":true,...,"migrations":2}`.

Manual alternative: run `DATABASE_URL=... npm run db:migrate`, or paste the SQL files into the Supabase SQL editor.

## Local development

```bash
npm install
npm run db:local                  # starts Postgres 16 on :54329 and prints its URL
export DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres
export ADMIN_PASSWORD=dev SESSION_SECRET=dev-secret-at-least-16-chars
npm run db:migrate && npm run dev
```

Without Supabase variables, evidence is stored in a database table (dev fallback) and Realtime is off
(polling only).

## Demo data

Load the demo teams (Lunar Labs, Orbit AI, Apollo Works) from *Admin → Teams → Load demo teams*, or run:

```bash
APP_URL=https://<app> ADMIN_PASSWORD=... npm run seed:demo    # prints codes
APP_URL=https://<app> ADMIN_PASSWORD=... npm run demo:remove  # deletes ONLY is_demo teams
```

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build:app
```

`npm test` spins up a real local Postgres and covers ledger and scoring rules, FIRST fairness and races,
caps, expiry and locking, voting rules, authorization, secret-challenge leakage, evidence privacy,
the RLS lockdown, and freeze/reveal.
