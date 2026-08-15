# Adding a game

This is the scalability contract. Game #12 requires **zero platform changes**:
one new package, and three registration lines that name it (§4). If you find
yourself editing anything else in `packages/core`, `packages/ui` or `apps/web`
to make a game work, that is a gap in the SDK — fix it there and record it in
DECISIONS.md.

Eleven games have been through this path. The SDK gaps they found — the
pending-input stack, the `__at` clock stamp, `predict` for optimistic play — are
in the SDK now, which is why the eleventh took the same shape as the first.

## 1. Scaffold

```
packages/games/<id>/
  package.json          name: @gambit/game-<id>
  tsconfig.json         extends ../../../tsconfig.base.json
  src/
    index.ts            exports the GameDefinition (default + named)
    state.ts            createState / legalMoves / applyMove / redactStateFor
    rules.ts            the pure rules, with no platform types in sight
    bot.ts              bot(view, legal, rng, level)
    Board.tsx           the React board
    tutorial.ts         the two-minute first hand
    <id>.test.ts        the three test-kit passes
```

## 2. Implement the contract

```ts
export const mygame: GameDefinition<MyState, MyMove, MyView> = {
  id: "mygame",
  version: "1.0.0",
  meta: { name, tagline, blurb, minPlayers, maxPlayers, avgMinutes,
          complexity, badges, themeTokens: { hue, felt, accent } },
  configSchema,      // Zod → the lobby options panel is generated from this
  createState, legalMoves, applyMove, currentSeats,
  redactStateFor, isTerminal, score, bot,
  Board, Tutorial, audioCues,
  predict, invariants, describeMove   // optional but wanted
};
```

Five rules that are not negotiable:

1. **`applyMove` is pure.** New state out; the input is never mutated. No
   `Date.now()`, no `Math.random()` — randomness comes from `Rng` seeded into
   the state, wall time arrives as `move.__at` (see DECISIONS D1).
2. **`redactStateFor` is the only path to a client.** If a hand, a secret
   position or a case file appears in the returned view, every client can see
   it. Write a leak test (`assertNoLeak`) for anything hidden.
3. **`legalMoves` is exhaustive and honest.** The UI lights what it returns and
   the bots choose from it. Every move it offers must be one `applyMove` accepts.
4. **Errors explain themselves.** `err(code, message)` — the message is shown to
   a player in a toast. "It's not your move yet", not "ERR_TURN".
5. **Events carry the story.** Each event gets `text` (ticker + screen reader),
   `sfx` (a cue name), and `visibleTo` when its payload is private.

## 3. Out-of-turn prompts

Interrupts — discard-on-seven, disprove-a-suggestion, consent-to-be-moved — are
modelled as a stack of `PendingInput` on the state. While the stack is non-empty,
`currentSeats` returns the prompted seats instead of the turn holder. Helpers:
`pushPending`, `resolvePending`, `pendingFor`, `pendingId`.

## 4. Register it

Three lines and a generated file — no platform code changes.

```ts
// packages/games/registry/src/index.ts
import mygame from "@gambit/game-mygame";
export const CATALOG = { chess, …, mygame };   // 1. the server catalogue
export const SHELF_ORDER = [ …, "mygame" ];     // 2. where it stands on the plank
```

```ts
// apps/web/lib/games.client.ts
const loaders = { …, mygame: () => import("@gambit/game-mygame") };  // 3. its own chunk
```

```bash
pnpm shelf-meta          # regenerates the shelf's metadata; a test enforces it
pnpm install             # workspace wiring
```

The third line is what keeps the browser from downloading eleven games to play
one; `pnpm perf` fails the build if the shelf ever starts carrying game data.

That is the entire platform change. The box appears on the shelf, the lobby
generates its options panel from `configSchema`, the table renders `Board`, and
the move pipeline, redaction, reconnection, replay, bots, timeouts, chat, share
cards, ratings, quick match and audio all work already.

## 5. Pass the test kit

```ts
import { checkProperties, simulateMany, replay } from "@gambit/sdk/testkit";

it("holds its invariants", () => {
  expect(checkProperties(mygame, { lines: 8 }).violations).toEqual([]);
});
it("finishes bot games", () => {
  expect(simulateMany(mygame, 200, { level: 1 }).failures).toEqual([]);
});
it("replays exactly", () => { /* same log → same fingerprint */ });
```

`checkProperties` asserts the platform-wide invariants for free: no seat is ever
to move with zero legal moves, a rejected move never mutates state, `applyMove`
never mutates its input, redaction never hands back the raw state, and a
malformed move is rejected rather than thrown at.

Then, before shipping:

```
pnpm sim <id> --games 500 --level 1     # a deep sweep of one game
pnpm sim <id> --games 200 --seats <max> # and at a full table
pnpm sim:all                            # the gate CI runs
```

Take the seat-count sweep seriously. Two of the eleven launch games shipped a
table that could not finish — Boxcar at five seats, where the map ran out before
the cars did, and one Landfall seed in a hundred where the bot traded itself into
a corner. Both were found here and nowhere else.

## 6. Board conventions

- Read `legal` for affordances; never re-derive legality in the component.
- Call `sfx(cue)` on input, not on server acknowledgement — the sound is part of
  the optimistic beat.
- Respect `reducedMotion`: it is passed in, and it means it.
- Bottom-sheet hand trays and pinch-zoom boards on mobile; keyboard where the
  game sensibly allows it; every piece and cell gets an `aria-label`.
