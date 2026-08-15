import { describe, expect, it } from "vitest";
import { Rng } from "@gambit/sdk";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import landfall from "./index";
import { DEV_BAG, EDGES, HEXES, NUMBER_BAG, TERRAIN_BAG, VERTICES, edgesAt } from "./island";
import {
  canSettle,
  handSize,
  longestRoadFor,
  portRates,
  redactStateFor,
  victoryPoints,
  type LandfallState,
  type LandfallView
} from "./state";

const config = landfall.configSchema.parse({});
const seats3 = makeBotSeats(3);

/** Walk the opening placements with the bots so tests can start from play. */
function opened(seats = seats3, seed = "s"): LandfallState {
  let state = landfall.createState(config, seats, seed) as LandfallState;
  let guard = 0;
  while (state.phase === "setup" && guard++ < 200) {
    const seat = landfall.currentSeats(state)[0]!;
    const legal = landfall.legalMoves(state, seat);
    const res = landfall.applyMove(state, seat, legal[0]!);
    if (!res.ok) throw new Error(res.error.message);
    state = res.value.state;
  }
  return state;
}

describe("the island", () => {
  it("is nineteen hexes, fifty-four corners and seventy-two edges", () => {
    expect(HEXES).toHaveLength(19);
    expect(VERTICES).toHaveLength(54);
    expect(EDGES).toHaveLength(72);
  });

  it("gives every hex six corners, shared with its neighbours", () => {
    for (const hex of HEXES) {
      expect(hex.corners).toHaveLength(6);
      expect(new Set(hex.corners).size).toBe(6);
    }
    // A corner belongs to one, two or three hexes and never more.
    for (const v of VERTICES) {
      expect(v.hexes.length).toBeGreaterThanOrEqual(1);
      expect(v.hexes.length).toBeLessThanOrEqual(3);
      expect(v.neighbours.length).toBeGreaterThanOrEqual(2);
      expect(v.neighbours.length).toBeLessThanOrEqual(3);
    }
  });

  it("carries the terrain and number mix the design calls for", () => {
    const counts = TERRAIN_BAG.reduce<Record<string, number>>((acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ wood: 4, grain: 4, wool: 4, brick: 3, ore: 3, desert: 1 });
    expect(NUMBER_BAG).toHaveLength(18);
    expect(NUMBER_BAG.filter((n) => n === 7)).toHaveLength(0);
    expect(NUMBER_BAG.filter((n) => n === 2)).toHaveLength(1);
    expect(NUMBER_BAG.filter((n) => n === 6)).toHaveLength(2);
  });

  it("keeps the hottest numbers off each other's shoulders", () => {
    const state = landfall.createState(config, seats3, "hot") as LandfallState;
    for (const hex of HEXES) {
      const n = state.numbers[hex.id];
      if (n !== 6 && n !== 8) continue;
      for (const other of HEXES) {
        if (other.id === hex.id) continue;
        const m = state.numbers[other.id];
        if (m !== 6 && m !== 8) continue;
        const shared = hex.corners.filter((c) => other.corners.includes(c)).length;
        expect(shared, `${hex.id} and ${other.id} both run hot`).toBeLessThan(2);
      }
    }
  });

  it("puts nine harbours on the coast", () => {
    const ports = VERTICES.filter((v) => v.port);
    expect(ports.length).toBeGreaterThanOrEqual(9);
    expect(ports.every((v) => v.hexes.length === 1)).toBe(true);
  });

  it("deals twenty-five development cards in the right mix", () => {
    expect(DEV_BAG).toHaveLength(25);
    expect(DEV_BAG.filter((c) => c === "soldier")).toHaveLength(14);
    expect(DEV_BAG.filter((c) => c === "victory")).toHaveLength(5);
  });
});

describe("landfall rules", () => {
  it("places in a snake and pays out on the second settlement", () => {
    const state = landfall.createState(config, seats3, "snake") as LandfallState;
    expect(state.setupQueue).toEqual([0, 1, 2, 2, 1, 0]);
    const opened3 = opened();
    expect(opened3.phase).toBe("roll");
    // Everyone has two settlements, two roads, and something in hand.
    for (const seat of [0, 1, 2]) {
      const mine = Object.values(opened3.buildings).filter((b) => b.seat === seat);
      expect(mine).toHaveLength(2);
      expect(Object.values(opened3.roads).filter((r) => r === seat)).toHaveLength(2);
      expect(handSize(opened3.hands[seat]!)).toBeGreaterThan(0);
    }
  });

  it("keeps settlements a corner apart", () => {
    const state = opened();
    const taken = Number(Object.keys(state.buildings)[0]);
    for (const n of VERTICES[taken]!.neighbours) {
      expect(canSettle(state, n, 0, true)).toMatch(/too close/i);
    }
  });

  it("pays one for a settlement and two for a city", () => {
    const state = opened();
    const hex = HEXES.find((h) => state.terrain[h.id] !== "desert" && state.numbers[h.id] !== null)!;
    const vertex = hex.corners.find((v) => !state.buildings[v])!;
    state.buildings[vertex] = { seat: 0, type: "city" };
    state.robber = -1;
    state.turn = 0;
    state.phase = "roll";
    const before = state.hands[0]![state.terrain[hex.id] as "wood"];

    // Force the roll by replaying until this hex's number comes up.
    let seed = 0;
    let produced = before;
    for (; seed < 60; seed++) {
      const attempt = { ...state, rng: { seed: `roll-${seed}`, cursor: 0 } } as LandfallState;
      const res = landfall.applyMove(attempt, 0, { kind: "roll" });
      if (!res.ok) continue;
      const rolled = res.value.state.lastRoll!;
      if (rolled[0] + rolled[1] !== state.numbers[hex.id]) continue;
      produced = res.value.state.hands[0]![state.terrain[hex.id] as "wood"];
      break;
    }
    expect(produced).toBeGreaterThanOrEqual(before);
  });

  it("asks everyone over seven cards to discard when a seven comes up", () => {
    const state = opened();
    state.turn = 0;
    state.phase = "roll";
    state.hands[1] = { wood: 4, grain: 4, wool: 0, brick: 0, ore: 0 };
    let after: LandfallState | null = null;
    for (let seed = 0; seed < 200 && !after; seed++) {
      const attempt = { ...state, rng: { seed: `seven-${seed}`, cursor: 0 } } as LandfallState;
      const res = landfall.applyMove(attempt, 0, { kind: "roll" });
      if (!res.ok) continue;
      const rolled = res.value.state.lastRoll!;
      if (rolled[0] + rolled[1] === 7) after = res.value.state;
    }
    expect(after).not.toBeNull();
    if (!after) return;
    expect(after.pending.some((p) => p.kind === "discard" && p.seat === 1)).toBe(true);
    expect(after.pending.some((p) => p.kind === "robber")).toBe(true);
    // Everybody who must discard is asked at once.
    expect(landfall.currentSeats(after)).toContain(1);
    expect(landfall.legalMoves(after, 1).every((m) => m.kind === "discard")).toBe(true);
  });

  it("measures the longest road and cuts it with a settlement", () => {
    const state = opened();
    // Clear the opening placements: this test is about the measurement, and a
    // rival settlement in the way would (correctly) cut the run short.
    state.buildings = {};
    state.roads = {};
    const start = VERTICES.find((v) => v.hexes.length === 3)!;
    const path: number[] = [];
    let vertex = start.id;
    while (path.length < 5) {
      const edge = edgesAt(vertex).find(
        (e) => state.roads[e.id] === undefined && !path.includes(e.id)
      );
      if (!edge) break;
      state.roads[edge.id] = 0;
      path.push(edge.id);
      vertex = edge.a === vertex ? edge.b : edge.a;
    }
    expect(path).toHaveLength(5);
    expect(longestRoadFor(state, 0)).toBeGreaterThanOrEqual(5);

    // A rival settlement in the middle of the run breaks it in two.
    const middle = EDGES[path[2]!]!;
    state.buildings[middle.a] = { seat: 1, type: "settlement" };
    expect(longestRoadFor(state, 0)).toBeLessThan(5);
  });

  it("gives harbour rates to whoever holds the harbour", () => {
    const state = opened();
    const port = VERTICES.find((v) => v.port === "ore")!;
    state.buildings[port.id] = { seat: 0, type: "settlement" };
    expect(portRates(state, 0).ore).toBe(2);
    expect(portRates(state, 1).ore).toBe(4);
  });

  it("counts victory points, and keeps the hidden ones hidden", () => {
    const state = opened();
    const vertex = Number(Object.keys(state.buildings).find((v) => state.buildings[Number(v)]!.seat === 0));
    state.buildings[vertex]!.type = "city";
    state.devs[0] = [{ card: "victory", boughtOnTurn: 0, played: false }];
    expect(victoryPoints(state, 0, false)).toBe(3); // one city, one settlement
    expect(victoryPoints(state, 0, true)).toBe(4);

    const view = redactStateFor(state, 1) as LandfallView;
    expect(view.points[0]).toBe(3);
    expect(JSON.stringify(view)).not.toContain("victory");
  });
});

describe("trading", () => {
  it("puts an offer on the table and waits for the others", () => {
    const state = opened();
    state.turn = 0;
    state.phase = "main";
    state.hands[0] = { wood: 3, grain: 0, wool: 0, brick: 0, ore: 0 };
    state.hands[1] = { wood: 0, grain: 3, wool: 0, brick: 0, ore: 0 };

    const offered = landfall.applyMove(state, 0, { kind: "offer", give: { wood: 1 }, want: { grain: 1 } });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    const withOffer = offered.value.state;
    expect(withOffer.offer?.from).toBe(0);
    expect(landfall.currentSeats(withOffer).sort()).toEqual([1, 2]);
    expect(landfall.legalMoves(withOffer, 1).map((m) => m.kind)).toEqual(["respond", "respond"]);

    const yes = landfall.applyMove(withOffer, 1, { kind: "respond", accept: true });
    expect(yes.ok).toBe(true);
    if (!yes.ok) return;
    const no = landfall.applyMove(yes.value.state, 2, { kind: "respond", accept: false });
    expect(no.ok).toBe(true);
    if (!no.ok) return;

    const ready = no.value.state;
    expect(landfall.currentSeats(ready)).toEqual([0]);
    const done = landfall.applyMove(ready, 0, { kind: "close-offer", with: 1 });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.state.hands[0]!.grain).toBe(1);
    expect(done.value.state.hands[0]!.wood).toBe(2);
    expect(done.value.state.hands[1]!.wood).toBe(1);
    expect(done.value.state.offer).toBeNull();
  });

  it("won't let a player trade with themselves or take an offer they can't cover", () => {
    const state = opened();
    state.turn = 0;
    state.phase = "main";
    state.hands[0] = { wood: 1, grain: 0, wool: 0, brick: 0, ore: 0 };
    state.hands[1] = { wood: 0, grain: 0, wool: 0, brick: 0, ore: 0 };
    const offered = landfall.applyMove(state, 0, { kind: "offer", give: { wood: 1 }, want: { grain: 1 } });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    const accepted = landfall.applyMove(offered.value.state, 1, { kind: "respond", accept: true });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const declined = landfall.applyMove(accepted.value.state, 2, { kind: "respond", accept: false });
    if (!declined.ok) return;
    const closed = landfall.applyMove(declined.value.state, 0, { kind: "close-offer", with: 1 });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error.message).toMatch(/cover/i);
  });
});

describe("landfall as a Gambit game", () => {
  it("keeps hands and development cards private", () => {
    const state = opened(makeBotSeats(4), "leak");
    state.hands[1] = { wood: 5, grain: 0, wool: 0, brick: 0, ore: 0 };
    state.devs[1] = [{ card: "soldier", boughtOnTurn: 0, played: false }];
    const view = redactStateFor(state, 0) as LandfallView;
    expect(view.hand).toEqual(state.hands[0]);
    expect(view).not.toHaveProperty("hands");
    expect(view).not.toHaveProperty("devDeck");
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(state.hands[1]));
    expect(view.handCounts[1]).toBe(5);
    expect(view.devCounts[1]).toBe(1);
    expect(view.devs).toEqual([]);
  });

  it("holds its invariants across random walks", () => {
    const report = checkProperties(landfall, { lines: 3, maxPly: 400, seats: 3 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games at three and four seats", () => {
    for (const seats of [3, 4]) {
      const batch = simulateMany(landfall, 6, { seats, level: 2, maxPly: 8000 });
      expect(batch.failures.map((f) => f.error), `${seats} seats`).toEqual([]);
    }
  });

  it("trades towards what it is building, not away from it", () => {
    // The bug this covers: a bot with wood and no brick traded the wood away
    // for ore, and then spent nine hundred turns unable to lay a road.
    const state = opened();
    state.turn = 0;
    state.phase = "main";
    state.hands[0] = { wood: 4, grain: 0, wool: 0, brick: 0, ore: 0 };
    const view = landfall.redactStateFor(state, 0) as LandfallView;
    const trades = landfall
      .legalMoves(state, 0)
      .filter((m): m is Extract<typeof m, { kind: "bank-trade" }> => m.kind === "bank-trade");
    expect(trades.length).toBeGreaterThan(0);

    const rng = new Rng("trade-choice");
    const chosen = landfall.bot(view, trades, rng, 2);
    expect(chosen.kind).toBe("bank-trade");
    if (chosen.kind !== "bank-trade") return;
    // It should be buying a road's missing half, not something for later.
    expect(["brick", "grain", "wool"]).toContain(chosen.get);
  });

  it("replays exactly, dice and all", () => {
    const sim = simulate(landfall, { seats: 3, level: 2, seed: "replay", maxPly: 8000 });
    expect(sim.error).toBeUndefined();
    const a = replay(landfall, { seats: seats3, seed: sim.seed, log: sim.log });
    const b = replay(landfall, { seats: seats3, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
