# Gambit

**Every table, one place.** Eleven board games, one lobby, one account — friends
on the same sofa or on the other side of the world.

Two constraints shape everything in this repository:

1. **Games are plugins.** Game #12 needs zero platform changes — one package and
   one registry line. See [ADDING_A_GAME.md](ADDING_A_GAME.md).
2. **Every interaction feels instant.** Your own move renders locally in under
   16ms; the network catches up afterwards.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

No database, no keys, nothing to provision: the dev server *is* the table. It
runs the same authoritative loop production runs, backed by an in-process store
and an SSE fan-out.

Open the site, pick a game, hit **Play here**, and scan the code with a phone on
the same network — that is the whole same-room flow.

## Layout

```
apps/web                 Next.js app: shelf, tables, tutorials, replay theatre
packages/sdk             the game contract + the test kit every game must pass
packages/core            rooms, moves, redaction, transport ports, replay, client
packages/ui              themes, audio engine, the Shelf, share cards, primitives
packages/games/<id>      one package per game
packages/games/registry  the catalogue — the only file a new game touches
supabase/migrations      production schema, RLS on every table
```

## Test

```bash
pnpm test                  # unit, property and integration tests
pnpm sim chess --games 500 # bot-versus-bot for one game, must finish clean
pnpm sim:all               # every game, at both ends of its seat range
pnpm e2e                   # two real clients against a real server
pnpm e2e:social            # profiles, friends, invites and blocking
pnpm db:check              # the production schema, on a real Postgres
pnpm perf                  # first-load budget, and the shelf carries no game
```

The test kit gives every game three passes for free: property checks (no seat
ever stuck, no state mutated, no redaction leak), a bot-versus-bot simulator, and
golden replays. On top of that each game brings its own: Chess verifies its move
generator against known perft counts to depth four, Boxcar checks every ticket on
every map is solvable and priced within a point of its shortest path, and Phantom
and Motive assert that the fugitive's position and the case file never appear in
a payload sent to anyone who should not have them.

## Production

`RoomStore`, `GameTransport` and `SocialPort` are ports. Development uses
memory + SSE; production uses Supabase (Postgres + Realtime), same interfaces.

Both stores are held to the same executable contract
(`packages/core/src/testkit/storeContract.ts`), so "the engine cannot tell them
apart" is a test rather than a claim. `pnpm db:check` applies the migrations to
a real Postgres and exercises the atomic append — the version check, the event
rows, the idempotency key — with no Supabase project needed. Point
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at a project and the
Supabase half of the contract runs too; without them it is skipped loudly rather
than passing quietly.

The browser picks its transport the same way: Supabase Realtime where it is
configured, SSE where a process stays alive to hold one open. The Realtime
client is behind a dynamic import, so a deployment that does not use it never
downloads it — `pnpm perf` fails the build if that regresses.

See [DEPLOY.md](DEPLOY.md) for both shapes, and Phase 2 in
[ROADMAP.md](ROADMAP.md) for `NearbyTransport`, which makes same-room play work
with no internet at all.

## Documents

- [DECISIONS.md](DECISIONS.md) — every call made and why
- [LEGAL.md](LEGAL.md) — the line between mechanics and expression, per game
- [CREDITS.md](CREDITS.md) — where everything came from
- [ADDING_A_GAME.md](ADDING_A_GAME.md) — the plugin path
- [DEPLOY.md](DEPLOY.md) — the two ways to host it, and what each costs you
- [GAMBIT_E2E_TESTING.md](GAMBIT_E2E_TESTING.md) — the nine layers of checks,
  what each catches, and what is still not covered
- [ROADMAP.md](ROADMAP.md) — what's next
