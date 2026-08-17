# Gambit — end-to-end testing

Nine layers, each answering a question the one below it cannot. They are listed
in the order they catch things, which is also the order to run them.

Every one of them exists because something got through. Where that is true, it
says so — a check whose reason has been forgotten is a check somebody will
delete.

---

## The short version

```bash
pnpm typecheck && pnpm test        # before every commit
pnpm e2e && pnpm e2e:social        # before every deploy
pnpm two-player                    # before believing two people can play
SWEEP_BASE=https://… pnpm sweep    # after every deploy
```

---

## 1. Types — `pnpm typecheck`

`tsc --noEmit` across all seventeen workspaces, strict.

Catches the mistakes that never reach a test: a config key renamed in one place,
a seat that might be `null`, a game returning the wrong move shape.

## 2. Unit and property tests — `pnpm test`

`vitest run` — 253 tests. Three kinds:

**Rules.** Each game asserts the things its rules promise: chess perft to depth
4 against known counts, Boxcar's card conservation, Landfall's robber, Motive's
deduction never leaking an answer.

**Properties.** `checkProperties` walks random legal games and asserts the
invariants hold at every step — no negative resources, no card created or
destroyed, no state a player can see that redaction should have hidden.

**Simulation.** `simulateMany` plays complete bot games at every seat count and
fails if one does not finish. This is how a game that *cannot end* gets caught,
which has happened: Boxcar's five-player table used to run out of routes before
anybody ran out of cars.

Determinism is checked by replay: the same seed and the same moves must produce
the same fingerprint, every time.

## 3. The store contract — `packages/core/src/testkit/storeContract.ts`

Eleven cases that any `RoomStore` must satisfy, run against **both**
implementations: the in-process one always, and the Postgres one when
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm test
```

Without those it **skips loudly** rather than passing quietly, because a green
tick that ran no queries is worse than a red one.

The first time this ran against a real database it failed on contact, and
everything it found would have hit every player: a schema that assumed accounts
in a product with none, player ids typed `uuid` when nothing generates one, and
a version conflict raised as SQLSTATE `40001` — a code PostgREST *retries*, so
two players moving at once took 125 seconds and returned a gateway timeout.

It cleans up after itself. A room left behind in a real project is not litter,
it is an open table somebody could walk into.

## 4. The schema against real Postgres — `pnpm db:check`

Starts a throwaway Postgres in Docker, applies `supabase/migrations/*.sql`, and
exercises the atomic append: version conflicts, idempotency keys, per-seat event
visibility, the room-code constraint.

Runs the whole battery **twice** — once in `public`, once in a schema of its own
— because Gambit can be installed alongside another product and both must behave
identically. 34 checks.

## 5. The move pipeline — `pnpm e2e`

Builds, starts the server, and plays through the HTTP API: create, join, deal,
move, reconnect and resume from a sequence number, idle-seat takeover. 14 checks.

Needs a production build (`pnpm build`). Running `next dev` afterwards replaces
`.next`, so build again before re-running.

## 6. People — `pnpm e2e:social`

Profiles, friend codes, requests, blocking, invites, and the data export and
erasure endpoints. 20 checks.

Blocking is checked from both sides: the blocked player must not be told, and
must not be seated at the same table.

## 7. Two people, one table — `pnpm two-player`

```bash
pnpm two-player                                        # local
SMOKE_BASE=https://gambit-swart.vercel.app pnpm two-player
SMOKE_GAME=landfall SMOKE_BASE=… pnpm two-player       # any of the eleven
```

Two separate cookie jars — as close to two devices as an HTTP client gets. One
opens a table, the other arrives on the code having never visited, sits down,
and they play a move each way. 13 checks.

**This is the layer that matters most, and it is the one that did not exist for
too long.** Every other check ran inside one process with one store, and all of
them were green while the deployed product could not seat a second player at
all: rooms were written to Postgres and looked for in a per-invocation Map, so
every invite link answered "No table with that code" while the row sat in the
database.

Run it against production after every deploy that touches rooms, identity or the
store.

## 8. Every screen, in a browser — `pnpm sweep`

```bash
pnpm sweep                                       # local, port 3211
SWEEP_BASE=https://gambit-swart.vercel.app pnpm sweep
```

Drives Chromium through the shelf, `/learn`, all eleven tutorials and all eleven
tables, at desktop (1440×900) and phone (390×844). Screenshots land in `.sweep/`
with a `findings.json` beside them.

Reports what can be measured rather than judged:

| Kind | What it means |
|---|---|
| `console` | the page complained — an error or a warning it raised itself |
| `crash` | an uncaught exception or a hydration mismatch |
| `network` | a request failed, or answered 4xx/5xx |
| `overflow` | the page scrolls sideways, which on a phone is always a bug |
| `target` | a control smaller than a thumb |
| `empty` | almost nothing rendered |

The screenshots are the point. Everything above this line asserts about state;
this is the only layer that has *seen* anything. It found a chessboard that was
not square — eight columns, a 1:1 aspect ratio and no rows declared, so ranks
holding pieces grew and the empty middle collapsed — which no assertion in the
suite was ever going to notice.

Two things it refuses to do, both learned the hard way:

- It **checks whose server it is** before sweeping. Ports 3000 and 3100 on a
  developer's machine often belong to something else, and an entire sweep was
  once photographed against a different product before anybody noticed.
- It **stops calling a broken server a product finding**. Building while
  `next dev` runs replaces the artefacts underneath it; one run reported 473
  findings that were all the same missing `.next`.

## 9. Deployment health — `pnpm preflight`

Run before `pnpm go-live`. Checks the four environment values, that the keys and
the connection string agree on one project, that the database accepts the
connection (and names the likely cause when it does not), what is already in
`public`, whether Gambit's schema is migrated, and whether it is exposed to the
API.

The exposure check probes a table that does not exist: an exposed schema answers
`PGRST205`, an unexposed one `PGRST106`. The root endpoint cannot tell those
apart, which is how the first version of this check passed against a schema that
was not exposed at all.

---

## Diagnostics

Not part of any suite; reach for them when something is wrong.

| Command | Question |
|---|---|
| `scripts/dev/find-overflow.ts <path>` | which element is making this page scroll sideways, and what contains it |
| `scripts/dev/check-console.ts <path>` | what did this one screen say to the console |
| `scripts/dev/measure-squares.ts` | are the board's squares actually square |
| `scripts/dev/hydration-probe.ts` | how often does a live table hydrate wrong |
| `scripts/dev/peek.ts` | what is in the database right now |
| `scripts/dev/expose-schema.ts` | what does the project's PostgREST config actually say |
| `pnpm perf` | is first-load JS still inside budget |
| `pnpm sim:all` | 1,320 bot games across every game and seat count |

---

## What is still not covered

Stated plainly, because a testing document that only lists strengths is
marketing.

- **Two real devices.** Everything above uses HTTP clients and headless
  Chromium. Nobody has held a phone, scanned the code and played a game on it.
- **Realtime under contention.** Optimistic concurrency is tested by direct
  version conflict, not by two humans moving in the same instant on real
  hardware.
- **An intermittent hydration mismatch.** Seen twice in about forty page loads
  on production, never once in six deliberate probe rounds. Open, and known.
- **Accessibility.** `aria` labels and reduced-motion are implemented and
  reduced-motion is what the sweep runs under, but nothing has been driven by a
  screen reader.
- **Load.** No test puts more than a handful of tables on a server at once.
