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

**Superseded by D33** in Phase F: the shelf renders from generated metadata and
each game loads as its own chunk, enforced by `scripts/perf-budget.ts`.

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

---

## Phase B — Quintet, Mosaic, Facet

### D16 · Generated boards beat transcribed ones

Quintet's ten-by-ten layout is generated from a fixed seed with a repair pass
that keeps a card's two faces at least four squares apart; Phantom's city,
Landfall's island and Remedy's world are built the same way. Three reasons: the
layouts are provably ours (see LEGAL.md), the topology is correct by
construction rather than by proofreading, and a constraint like "no two hot
numbers adjacent" is enforced rather than hoped for.

The seeds are frozen strings. Changing one changes the board for everybody, so
they are versioned in the name: `gambit-quintet-board-v1`.

### D17 · Interrupts run on one stack, in the SDK

Facet's ten-token cap and its two-patrons-at-once choice were the first real
interrupts. Rather than let each game invent its own, `pendingInput` is part of
`BaseState`, `currentSeats` returns the prompted seat while the stack is
non-empty, and the platform needs no game-specific knowledge to route it. Every
later interrupt — Boxcar's tunnels, Motive's disprove, Landfall's seven, the
Remedy courier's request — is the same mechanism.

### D18 · One patron per turn

Two patrons qualifying at once is a choice, not two visits. `nobleThisTurn`
gates it. Found by a test that expected 3 prestige and got 6.

---

## Phase C — Boxcar, Hamlet, Stronghold

### D19 · Tunnel payments are held aside, not discarded

Paying for a tunnel and then revealing three cards can reshuffle the discard
into the deck — and with it the cards you just paid. Withdrawing then handed
the player cards that no longer existed anywhere, and the deck grew by four.
The payment now sits in the tunnel record until the mountain has spoken, which
is also how it works on a table. The card-conservation invariant counts it.

### D20 · Claim payments offer the fewest wilds

Enumerating every colour-and-locomotive split for every route would put
thousands of moves in a payload. `legalMoves` offers, per colour, the payment
that spends the fewest locomotives (respecting a ferry's minimum), because
spending more wilds than a route demands is never better. Players who want to
burn a locomotive anyway can — `applyMove` accepts it; it simply isn't offered.

### D21 · Hamlet's fields are per-tile regions

Full field topology — two half-fields per edge, split by roads — is a large
amount of machinery for a small amount of game. A tile's field is one region,
joined across edges, scoring three per completed keep it touches. Documented
here because it is a deliberate simplification of the genre, not an oversight.

### D22 · Stronghold has a sundown rule

Conquest games between cautious players can stall forever: everyone digs in and
nobody attacks. After a dozen turns each with nothing changing hands, the widest
holding takes it. Real games effectively never reach it; it exists so that no
online table can hang. The bots also grow bolder as their share of the armies
grows, which is the fix for the cause rather than the symptom.

---

## Phase D — Phantom, Motive

### D23 · The fugitive's node is in exactly one payload

`redactStateFor` substitutes the last *sighting* for the fugitive's position for
every viewer except the fugitive — and, once the game is over, everybody. The
leak test plays a dozen rounds and then asserts the node appears in no
detective's and no spectator's serialised view. This is the game the platform's
redaction promise is measured against.

### D24 · Two nodes can be joined by two kinds of line

The transport must be matched as well as the destination. A cab and a tram
between the same pair used to make `legalMoves` and `applyMove` disagree —
found by the property harness, not by a person.

### D25 · Motive publishes the record of every suggestion

Who asked, what they named, who passed and who answered are all public at a real
table, and they are the raw material of every deduction. Keeping that log in the
state (and the view) is what lets the bots — and the notepad — reason properly.

### D26 · Motive offers only accusations you haven't disproved

Six suspects by six implements by nine rooms is 324 moves. `legalMoves` filters
by what that seat can already prove is not in the file — its own cards, what it
has been shown, the face-up leftovers — which is information the player already
has, so nothing leaks and the payload stays small.

### D27 · The night ends

Forty rounds and the file is opened unsolved. Cautious players would otherwise
circle forever, and an online table cannot be left open overnight.

---

## Phase E — Landfall, Remedy

### D28 · Island geometry is derived, then deduplicated by position

Hex corners reached from two different hexes differ in the sixteenth decimal —
and, worse, in the sign of a zero. Rounding to a thousandth and normalising -0
away made 56 corners become the 54 the board actually has.

### D29 · You can only accept a trade you can pay for

Checked when the offer is answered, not when it is closed. Doing it at the close
would have let the offerer learn what you were holding from what you were
allowed to answer.

### D30 · A turn cannot be haggled away

Two offers a turn, and the bot values a trade below ending its turn unless it is
short of something specific. Without both, three bots traded with each other
until the heat death of the universe.

### D31 · The robber blocks everything until it is placed

While a robber prompt is open, that seat's only legal moves are placements. The
first draft let a player end their turn with the prompt still open, which
stranded the table on a seat whose turn had passed.

### D32 · Asking costs the action

Remedy's courier spends the action when they ask, not when the answer comes
back. Otherwise a refusal is free and the courier asks again forever.

---

## Phase F — product

### D33 · The shelf never ships a game

`packages/games/registry/src/meta.ts` is generated from the catalogue and holds
names, taglines, hues and player counts — no rules, no maps, no boards. The
lobby imports that; tables import the one game they need through
`lib/games.client.ts`, which the bundler splits per game. `scripts/perf-budget.ts`
enforces both the first-load budget and the rule that no shelf chunk contains
game data. This resolves D12.

### D34 · Ratings are Glicko-lite, multiplayer as a round robin

A rating, a deviation that grows with idleness and shrinks with play, and no
volatility term — the part of Glicko-2 that earns its keep below a very large
scale. A five-player table is scored as every pair against each other, which
gives sensible numbers without inventing new mathematics.

### D35 · Quick match fills the fullest table

Rather than spreading players across half-empty rooms. Same-room tables are
never offered to strangers.

### D36 · The tutorial is the real game

`/learn/[gameId]` runs the actual `createState`, `legalMoves` and `Board`
against the game's own bot, on the device. A scripted mock-up would drift out of
step with the rules the first time a rule changed; this cannot.

---

## After Phase F — closing the two gaps that were left open

### D37 · The production schema is executed, not trusted

Everything else in the repository was verified by running it; the SQL was the
one part taken on faith. `pnpm db:check` now applies `supabase/migrations` to a
real Postgres — in a throwaway container locally, as a service in CI — and then
exercises `append_game_events` directly: a first append lands at version 1, a
stale version is refused and changes nothing, a private event keeps its seat
list, and a repeated idempotency key writes one move rather than two.

Supabase supplies `auth.users` and `auth.uid()`, which a bare Postgres does not,
so the harness creates those shapes first. That is the only difference between
the check and the real thing.

### D38 · One contract, both stores

`packages/core/src/testkit/storeContract.ts` is the `RoomStore` specification as
eleven executable cases. The memory store runs them on every `pnpm test`; the
Supabase store runs the same list when a project is configured, and **skips
loudly** when one is not, because a green tick that means "we didn't look" is
worse than a red one.

### D39 · Blocking is a port, not a feature branch

Friends, profiles, invites and reports are product concerns and live above the
engine. Blocking is not: it changes who may join a room and who quick match will
seat you with. So the engine takes a `SocialPort` with exactly one method —
`blocked(a, b)` — and a deployment without a social layer passes `undefined` and
behaves as before.

The refusal is deliberately vague ("You can't join that table"), and never says
a block exists or who set it. Telling somebody who blocked them is how a block
becomes an argument.

### D40 · A profile is a name, an emoji and a code

No uploads, no photographs, no email — nothing that needs hosting, moderation or
a deletion pipeline. The friend code uses the room-code alphabet, so it survives
being read aloud across a table. The avatar accepts exactly one character, which
is what stops the avatar slot becoming a second, unmoderated name field.

### D41 · The profile is the only display name

The cookie still carries a name so a first-time visitor has one before they have
a profile, but every room-facing route reads `displayName()`, which prefers the
profile. Renaming yourself in the people panel renames you at every table at
once, rather than leaving two names to drift apart.
