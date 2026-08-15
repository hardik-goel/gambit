# Decisions

Every call made while building Gambit that a future reader might otherwise have
to reverse-engineer. Newest section last; nothing is deleted, only superseded.

---

## Phase A — core, SDK, Chess

### D1 · `applyMove` is pure, and the platform stamps the clock

Games must be deterministic to give us replays, optimistic play and an anti-cheat
audit trail. But some games need wall-clock time (chess clocks, turn deadlines),
and reading `Date.now()` inside `applyMove` would destroy determinism.

**Decision:** the move pipeline stamps every move object with `__at`, the
server's clock, *before* calling `applyMove` (`packages/core/src/engine.ts`).
Games that care read it; the rest ignore it. Because the stamp is written into
the logged move, a replay of that log reproduces the original game exactly.

### D2 · Optimistic *prediction*, not optimistic *simulation*

A client holds a redacted view, not the state, so it cannot always run
`applyMove` locally. The SDK therefore has an optional `predict(view, seat, move)`
which returns the visible consequence of your own move. Perfect-information games
(Chess) implement it with the real rules; hidden-information games will move what
is visible and leave unknowns as placeholders until the server delta lands.

Measured: an optimistic move renders in **under 16ms at 300ms simulated RTT**
(`packages/core/src/engine.test.ts`).

### D3 · Local-first authority, remote-ready ports

Two ports — `RoomStore` and `Broadcaster`/`GameTransport` — sit between the
engine and the world. v1 ships `MemoryRoomStore` + SSE, which makes the whole
platform runnable with `pnpm dev` and no external service, and is genuinely good
enough for same-room play on home wifi. The Supabase implementations satisfy the
same interfaces for production. Phase 2's `NearbyTransport` is a third
implementation, not a rewrite. See ROADMAP.md.

### D4 · `append` is the only writer of (version, state, events)

An early draft wrote the snapshot and the event log separately, which let version
and state drift apart by one on the very first move. Now a single atomic `append`
does all three, and `putSnapshot` remains on the port only for bootstrap/repair.

### D5 · Idempotency is checked before the room's status

The move that ends a game moves the room to `finished`. If a client loses the
response to its own checkmate and retries, a status check placed first would
answer "this table isn't in play". Idempotency is therefore the first thing
checked after the room is loaded.

### D6 · Bots are seeded from (game seed, version, seat)

Bot randomness comes from `new Rng(`${seed}:bot:${version}:${seat}`)`, so a table
containing bots still replays exactly. A bot that fails to produce a move falls
back to a random legal one rather than stalling the table.

### D7 · Room codes avoid ambiguous glyphs

The alphabet excludes O/0, I/1 and S/5 — codes are read aloud across a table and
typed by people who are not looking at the screen.

### D8 · Draw offers ride along with a move

Offering a draw as a standalone action either stalls the turn or dies before the
opponent can answer it. Chess models an offer the way a board does: it is a flag
on the move you just played (`{kind:"move", …, offerDraw:true}`), answered by the
opponent on their turn, and declined implicitly by playing on.

### D9 · Chess clocks are settled on the move, not by a watchdog

Elapsed time is deducted from the mover when their move lands, and flag-fall ends
the game there — as a draw if the opponent lacks mating material, per FIDE. A
player who abandons the table entirely is handled by the platform's turn-timeout
bot takeover, so no table can hang waiting for a flag claim.

### D10 · `legalMoves` is the single source of affordances

The UI never computes legality. Lit squares, the illegal-tap explanation and all
three bot levels read the same function, so the game can never disagree with
itself about what is allowed. The test kit asserts that every move `legalMoves`
offers is one `applyMove` accepts.

### D11 · Relative imports carry no file extension

TypeScript's `.js`-suffixed relative imports are correct for Node ESM but Next's
bundler will not resolve them onto `.ts` sources. Since workspace packages ship
TypeScript source and are compiled by the app (`transpilePackages`), imports are
written extensionless throughout.

### D12 · The whole catalogue is in the client bundle, for now

`RoomView` imports the registry directly. With one game that is 21kB; by eleven
it will not be, and the Board import becomes a `next/dynamic` per game id. Noted
here so it is a scheduled change rather than a surprise.

### D13 · Identity before accounts

A player is a cookie-borne random id plus a display name — enough to be seated in
under ten seconds without a signup wall. Supabase Auth (email OTP, Google, Apple)
replaces the id with a profile id in Phase F; nothing else changes.

### D14 · Sound is generated, not sampled

See CREDITS.md. Synthesis removes the sample-licensing question entirely, gives a
trigger latency bounded by an audio quantum rather than a fetch, and lets every
cue carry ±4% pitch jitter so repeated sounds never machine-gun.

### D15 · Chess bot node ceilings

Level 1 searches depth 2 with a 6,000-node ceiling and up to a third of a pawn of
noise; level 2 depth 3; level 3 depth 4 with no noise. The ceilings exist so that
a table never waits on a bot and so five hundred bot-versus-bot simulations
finish in minutes rather than hours.
