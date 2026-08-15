import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import facet from "./index";
import { DECK_1, DECK_2, DECK_3, GOLD, NOBLES, tokensPerGem } from "./cards";
import { payment, tokenCount, type FacetState, type FacetView } from "./state";

const config = facet.configSchema.parse({});
const seats2 = makeBotSeats(2);

describe("the deck", () => {
  it("is cut to the right sizes", () => {
    expect(DECK_1).toHaveLength(40);
    expect(DECK_2).toHaveLength(30);
    expect(DECK_3).toHaveLength(20);
    expect(NOBLES).toHaveLength(10);
  });

  it("gets more expensive and more valuable as the tiers climb", () => {
    const avg = (cards: typeof DECK_1) =>
      cards.reduce((n, c) => n + c.cost.reduce((a, b) => a + b, 0), 0) / cards.length;
    expect(avg(DECK_1)).toBeLessThan(avg(DECK_2));
    expect(avg(DECK_2)).toBeLessThan(avg(DECK_3));
    expect(Math.max(...DECK_1.map((c) => c.prestige))).toBeLessThanOrEqual(1);
    expect(Math.min(...DECK_3.map((c) => c.prestige))).toBeGreaterThanOrEqual(3);
  });

  it("cuts every shape once in each gem", () => {
    for (const deck of [DECK_1, DECK_2, DECK_3]) {
      const byGem = new Map<number, number>();
      for (const c of deck) byGem.set(c.gem, (byGem.get(c.gem) ?? 0) + 1);
      expect([...byGem.values()]).toEqual(Array(5).fill(deck.length / 5));
    }
  });

  it("sets the bank by table size", () => {
    expect(tokensPerGem(2)).toBe(4);
    expect(tokensPerGem(3)).toBe(5);
    expect(tokensPerGem(4)).toBe(7);
  });
});

describe("facet rules", () => {
  it("only lets you take two from a pile of four or more", () => {
    const state = facet.createState(config, seats2, "s") as FacetState;
    state.bank = [4, 3, 3, 3, 3, 5];
    const moves = facet.legalMoves(state, 0);
    expect(moves.some((m) => m.kind === "take2" && m.gem === 0)).toBe(true);
    expect(moves.some((m) => m.kind === "take2" && m.gem === 1)).toBe(false);

    const bad = facet.applyMove(state, 0, { kind: "take2", gem: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toMatch(/four or more/i);
  });

  it("pays with discounts first and gold last", () => {
    const state = facet.createState(config, seats2, "s") as FacetState;
    const player = state.players[0]!;
    const card = { id: "x", tier: 1 as const, gem: 0 as const, prestige: 0, cost: [3, 0, 0, 0, 0] };
    player.tokens = [1, 0, 0, 0, 0, 1];
    expect(payment(player, card)).toBeNull(); // 1 token + 1 gold ≠ 3

    player.bought = [{ id: "d", tier: 1, gem: 0, prestige: 0, cost: [0, 0, 0, 0, 0] }];
    const settled = payment(player, card);
    expect(settled).toEqual({ pay: [1, 0, 0, 0, 0], gold: 1 });
  });

  it("hands out a gold token with a reservation, and caps reservations at three", () => {
    let state = facet.createState(config, seats2, "s") as FacetState;
    for (let i = 0; i < 3; i++) {
      const res = facet.applyMove(state, i % 2 === 0 ? 0 : 0, { kind: "reserve", tier: 1, index: 0 });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      state = res.value.state;
      state.turn = 0; // keep it on the same player for the test
      state.pending = [];
    }
    expect(state.players[0]!.reserved).toHaveLength(3);
    expect(state.players[0]!.tokens[GOLD]).toBe(3);
    const fourth = facet.applyMove(state, 0, { kind: "reserve", tier: 1, index: 0 });
    expect(fourth.ok).toBe(false);
  });

  it("makes a player hand tokens back when they go over ten", () => {
    let state = facet.createState(config, makeBotSeats(4), "s") as FacetState;
    state.players[0]!.tokens = [2, 2, 2, 2, 1, 0]; // nine
    const res = facet.applyMove(state, 0, { kind: "take3", gems: [0, 1, 2] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;

    // The turn does not move on until the excess is handed back.
    expect(state.pending).toHaveLength(1);
    expect(facet.currentSeats(state)).toEqual([0]);
    expect(facet.legalMoves(state, 0).every((m) => m.kind === "return")).toBe(true);
    expect(facet.legalMoves(state, 1)).toEqual([]);

    const back = facet.applyMove(state, 0, { kind: "return", gem: 0 });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const settled = back.value.state;
    expect(tokenCount(settled.players[0]!)).toBe(11);
    expect(settled.pending).toHaveLength(1); // still one over

    const again = facet.applyMove(settled, 0, { kind: "return", gem: 1 });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.state.pending).toHaveLength(0);
    expect(again.value.state.turn).toBe(1);
  });

  it("sends a patron automatically, and asks when two qualify", () => {
    const state = facet.createState(config, seats2, "s") as FacetState;
    const player = state.players[0]!;
    // Two patrons, both satisfied by the same holdings.
    state.nobles = [
      { id: "a", prestige: 3, requirement: [4, 4, 0, 0, 0] },
      { id: "b", prestige: 3, requirement: [3, 3, 3, 0, 0] }
    ];
    player.bought = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `o${i}`, tier: 1 as const, gem: 0 as const, prestige: 0, cost: [0, 0, 0, 0, 0] })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, tier: 1 as const, gem: 1 as const, prestige: 0, cost: [0, 0, 0, 0, 0] })),
      ...Array.from({ length: 3 }, (_, i) => ({ id: `e${i}`, tier: 1 as const, gem: 2 as const, prestige: 0, cost: [0, 0, 0, 0, 0] }))
    ];
    const res = facet.applyMove(state, 0, { kind: "take3", gems: [0, 1, 2] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.pending[0]?.kind).toBe("choose-noble");

    const chosen = facet.applyMove(res.value.state, 0, { kind: "noble", index: 0 });
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(chosen.value.state.players[0]!.prestige).toBe(3);
    expect(chosen.value.state.nobles).toHaveLength(1);
  });

  it("plays out the round after someone reaches the target", () => {
    const state = facet.createState(config, makeBotSeats(3), "s") as FacetState;
    state.players[1]!.prestige = 14;
    state.turn = 1;
    // Seat 1 crosses fifteen; seats 2 and 0 still get a turn.
    const state2 = { ...state, players: { ...state.players } };
    state2.players[1] = { ...state.players[1]!, prestige: 15 };
    const res = facet.applyMove(state2, 1, { kind: "take3", gems: [0, 1, 2] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.finishing).toBe(true);
    expect(res.value.state.finished).toBe(false);
    expect(res.value.state.turn).toBe(2);
  });
});

describe("facet as a Gambit game", () => {
  it("never shows one player another player's reserved cards", () => {
    const state = facet.createState(config, makeBotSeats(3), "s") as FacetState;
    state.players[1]!.reserved = [state.decks[3][0]!];
    const view = facet.redactStateFor(state, 0) as FacetView;
    expect(view.reserved).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(state.decks[3][0]!.id);
    expect(view.players[1]!.reservedCount).toBe(1);
    // And the decks themselves stay face down.
    expect(view).not.toHaveProperty("decks");
    expect(view.deckCounts[1]).toBe(state.decks[1].length);
  });

  it("keeps tokens, cards and prestige consistent across random walks", () => {
    const report = checkProperties(facet, { lines: 4, maxPly: 400, seats: 3 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games at every table size", () => {
    for (const seats of [2, 3, 4]) {
      const batch = simulateMany(facet, 25, { seats, level: 2, maxPly: 1500 });
      expect(batch.failures.map((f) => f.error)).toEqual([]);
      expect(batch.ok).toBe(25);
    }
  });

  it("reaches the target rather than grinding to a halt", () => {
    const sim = simulate(facet, { seats: 3, level: 2, seed: "target" });
    expect(sim.terminal).toBe(true);
    expect(Math.max(...sim.scores.map((s) => s.total))).toBeGreaterThanOrEqual(15);
  });

  it("replays exactly", () => {
    const sim = simulate(facet, { seats: 2, level: 2, seed: "replay" });
    const a = replay(facet, { seats: seats2, seed: sim.seed, log: sim.log });
    const b = replay(facet, { seats: seats2, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
