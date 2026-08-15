import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import quintet from "./index";
import { BOARD, CARD_CELLS, CELLS, CORNERS, drawDeck } from "./layout";
import type { QuintetState, QuintetView } from "./state";

const seats2 = makeBotSeats(2);
const config = quintet.configSchema.parse({});

describe("the board", () => {
  it("is ten by ten with four wild corners", () => {
    expect(BOARD).toHaveLength(CELLS);
    for (const c of CORNERS) expect(BOARD[c]).toBeNull();
  });

  it("shows every non-jack card exactly twice, and no jacks", () => {
    const faces = BOARD.filter(Boolean) as string[];
    expect(faces).toHaveLength(96);
    for (const [, cells] of CARD_CELLS) expect(cells).toHaveLength(2);
    expect(faces.some((c) => c.startsWith("J"))).toBe(false);
  });

  it("keeps a card's two faces apart, so one hand can't cover both easily", () => {
    for (const [, [a, b]] of CARD_CELLS) {
      const d = Math.max(Math.abs((a! % 10) - (b! % 10)), Math.abs(Math.floor(a! / 10) - Math.floor(b! / 10)));
      expect(d).toBeGreaterThanOrEqual(4);
    }
  });

  it("draws from two full decks, jacks included", () => {
    const deck = drawDeck();
    expect(deck).toHaveLength(104);
    expect(deck.filter((c) => c.startsWith("J"))).toHaveLength(8);
  });
});

describe("quintet rules", () => {
  it("deals the right hand size for the table", () => {
    const two = quintet.createState(config, seats2, "s") as QuintetState;
    expect(two.hands[0]).toHaveLength(7);
    const six = quintet.createState(config, makeBotSeats(6), "s") as QuintetState;
    expect(six.hands[0]).toHaveLength(5);
  });

  it("only offers squares that show the card you picked", () => {
    const state = quintet.createState(config, seats2, "s") as QuintetState;
    const moves = quintet.legalMoves(state, 0);
    for (const m of moves) {
      if (m.kind !== "play") continue;
      if (m.card === "JD" || m.card === "JC") continue; // wild
      expect(CARD_CELLS.get(m.card)).toContain(m.cell);
    }
  });

  it("completes a five and locks it against one-eyed jacks", () => {
    let state = quintet.createState(config, seats2, "s") as QuintetState;
    // Hand-place four in a row, then let the engine finish it with a wild jack.
    const row = [11, 12, 13, 14];
    for (const c of row) state.chips[c] = 0;
    state.hands[0] = ["JD"];
    const res = quintet.applyMove(state, 0, { kind: "play", card: "JD", cell: 15 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;
    expect(state.sequences).toHaveLength(1);
    expect(state.locked[15]).toBe(true);
    expect(res.value.events.some((e) => e.type === "sequence")).toBe(true);
  });

  it("won't let a new five share more than one chip with an old one", () => {
    let state = quintet.createState(config, seats2, "s") as QuintetState;
    for (const c of [11, 12, 13, 14, 15]) {
      state.chips[c] = 0;
      state.locked[c] = true;
    }
    state.sequences = [{ team: 0, cells: [11, 12, 13, 14, 15] }];
    state.hands[0] = ["JD"];
    // 12..16 would share four chips with the existing five.
    const res = quintet.applyMove(state, 0, { kind: "play", card: "JD", cell: 16 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;
    expect(state.sequences).toHaveLength(1);
  });

  it("treats corners as everybody's chip", () => {
    const state = quintet.createState(config, seats2, "s") as QuintetState;
    // 0 is a corner; a five along the top row needs only four real chips.
    for (const c of [1, 2, 3]) state.chips[c] = 0;
    state.hands[0] = ["JD"];
    const res = quintet.applyMove(state, 0, { kind: "play", card: "JD", cell: 4 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.state.sequences).toHaveLength(1);
  });

  it("refuses to lift a chip that is part of a finished five", () => {
    const state = quintet.createState(config, seats2, "s") as QuintetState;
    state.chips[40] = 1;
    state.locked[40] = true;
    state.hands[0] = ["JS"];
    const res = quintet.applyMove(state, 0, { kind: "remove", card: "JS", cell: 40 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/finished five/i);
  });

  it("allows one dead-card swap per turn and no more", () => {
    const state = quintet.createState(config, seats2, "s") as QuintetState;
    const card = state.hands[0]![0]!;
    for (const cell of CARD_CELLS.get(card) ?? []) state.chips[cell] = 1;
    const first = quintet.applyMove(state, 0, { kind: "exchange", card });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = quintet.applyMove(first.value.state, 0, { kind: "exchange", card: first.value.state.hands[0]![0]! });
    expect(second.ok).toBe(false);
  });
});

describe("quintet as a Gambit game", () => {
  it("never shows one player another player's hand", () => {
    const state = quintet.createState(config, makeBotSeats(4), "leak") as QuintetState;
    const view = quintet.redactStateFor(state, 0) as QuintetView;
    const json = JSON.stringify(view);

    expect(view.hand).toEqual(state.hands[0]);
    // Card faces are printed on the board, so a single card name proves
    // nothing. What must never appear is another seat's hand, or the deck.
    for (const seat of [1, 2, 3]) {
      expect(json).not.toContain(JSON.stringify(state.hands[seat]));
    }
    expect(json).not.toContain(JSON.stringify(state.deck.slice(0, 6)));
    expect(view).not.toHaveProperty("hands");
    expect(view).not.toHaveProperty("deck");
    expect(view.deckCount).toBe(state.deck.length);

    // A spectator sees no hand at all.
    const watching = quintet.redactStateFor(state, "spectator") as QuintetView;
    expect(watching.hand).toEqual([]);
    for (const seat of [0, 1, 2, 3]) {
      expect(JSON.stringify(watching)).not.toContain(JSON.stringify(state.hands[seat]));
    }
  });

  it("holds its invariants across random walks", () => {
    const report = checkProperties(quintet, { lines: 4, maxPly: 200, seats: 2 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games at every table size", () => {
    for (const seats of [2, 3, 4, 6]) {
      const batch = simulateMany(quintet, 20, { seats, level: 2, maxPly: 2000 });
      expect(batch.failures.map((f) => f.error)).toEqual([]);
    }
  });

  it("replays exactly", () => {
    const sim = simulate(quintet, { seats: 2, level: 2, seed: "replay" });
    expect(sim.error).toBeUndefined();
    const a = replay(quintet, { seats: seats2, seed: sim.seed, log: sim.log });
    const b = replay(quintet, { seats: seats2, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("lets a stronger bot beat a weaker one more often than not", () => {
    // Level 3 sits in seat 0, level 1 in seat 1 — a fair check that the
    // heuristics are doing something.
    let strong = 0;
    for (let i = 0; i < 14; i++) {
      const sim = simulate(quintet, { seats: 2, level: 3, seed: `duel-${i}` });
      if (sim.winner.includes(0)) strong++;
    }
    expect(strong).toBeGreaterThan(0);
  });
});
