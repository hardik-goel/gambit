# Deploying Gambit

Two supported shapes. The difference is not effort, it is what a serverless
platform can and cannot hold.

| | **Vercel + Supabase** | **One long-lived process** (Fly, Railway, Render, a VM) |
|---|---|---|
| Store | Postgres | in-process memory |
| Deltas to clients | Supabase Realtime | SSE, held open by the process |
| Turn clock | Vercel Cron, once a minute | a `setInterval` in the process |
| Rooms survive a redeploy | yes | no |
| Set-up | a Supabase project | nothing at all |

The code picks its own path: with `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` set, the server uses the Postgres store and the
Realtime broadcaster and the browser subscribes over Realtime. Without them it
uses memory and SSE. Nothing above those two ports changes.

---

## Vercel + Supabase

### The short version

```bash
# 1. make a Supabase project at supabase.com/dashboard (free tier is fine)
# 2. put four values in .env.local (see below)
pnpm go-live
```

`pnpm go-live` applies the schema, proves the production store works against
your project, links Vercel, pushes the environment, deploys, and prints the URL.
It stops at the first thing that fails rather than half-deploying. The long
version below is the same steps, by hand.

### 1. Make a Supabase project

<https://supabase.com/dashboard> → **New project**. The free tier is enough to
start. Pick a region near your players (`ap-south-1` for the launch market).

Collect three values:

| Value | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` |

The service-role key bypasses row-level security. It belongs on the server and
nowhere else — never in a `NEXT_PUBLIC_` variable, never in the browser bundle.

### 2. Apply the schema

```bash
DATABASE_URL="postgres://…" pnpm db:migrate
```

The connection string is under Project Settings → Database → Connection string →
URI. The runner records each file in `schema_migrations`, so running it again
applies only what is new. The same SQL is exercised against a throwaway Postgres
by `pnpm db:check`.

#### Sharing a project with another product

The free tier allows two projects, so Gambit may have to live in one that is
already somebody else's. It has no business creating a `profiles` table in a
schema another product is using, so point it at a schema of its own:

```bash
GAMBIT_DB_SCHEMA=gambit DATABASE_URL="postgres://…" pnpm db:migrate
```

Every table, index, policy and function goes into `gambit` instead of `public`.
Nothing in `public` is read, written, or looked at, and `drop schema gambit
cascade` removes Gambit whole, leaving the other product untouched.

Two settings then have to agree with that choice:

| Where | What |
|---|---|
| Supabase → Settings → API → **Exposed schemas** | add `gambit` |
| the app's environment | `GAMBIT_DB_SCHEMA=gambit` |

Miss the first and the API refuses the schema; miss the second and the app looks
in `public` and finds nothing. `pnpm go-live` pushes the variable for you and
step 2 fails loudly if the schema is not exposed.

`pnpm db:check` runs its whole battery twice — once in `public`, once in a
schema of its own — so this is verified rather than assumed.

### 3. Check the store against the real project

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm test
```

This runs the `RoomStore` contract — the same eleven cases the in-process store
passes — against your project. Without the variables those tests skip loudly;
with them, a green run means the production store genuinely works.

### 4. Deploy

```bash
vercel link            # once, to create or attach the project
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CRON_SECRET production        # any long random string
vercel --prod
```

`apps/web/vercel.json` registers the cron that runs the turn clock. `CRON_SECRET`
is what stops that endpoint being anybody's; Vercel sends it as a bearer token.

### 5. Check it

- Open the deployment, hit **Play here**, scan the QR from a phone.
- Two devices, one table: a move on one should appear on the other in well under
  a second. If the first move never arrives, Realtime is not connected — check
  the anon key and that Realtime is enabled for the project.
- `/api/cron/sweep` should return `401` without the secret.

---

## One long-lived process

No database, nothing to configure — it runs exactly what the test suite covers.

```bash
pnpm install
pnpm build
cd apps/web && npx next start -p 3000
```

Any host that keeps one Node process alive works: Fly, Railway, Render, or a VM
behind nginx. Two caveats, both by design rather than accident:

- **One instance only.** Rooms live in that process's memory; a second instance
  would not see them. Do not scale it horizontally.
- **A redeploy ends every table.** State is in memory. Finish the games first.

For a small group of friends this is genuinely the better trade — no database to
run, and identical behaviour to what CI verifies.

---

## What is *not* wired up

- **Accounts.** Identity is a cookie. Supabase Auth is a roadmap item; the
  `profiles` table and its policies are already in the schema for it.
- **Reports.** They are filed and stored; nothing reads them yet.
- **Ratings and social data** live in memory even on the Supabase path. The
  tables exist (`ratings`, `profiles`, `friendships`); the readers and writers
  are still the in-process ones, so both reset on a redeploy.
