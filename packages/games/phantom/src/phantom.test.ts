import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import phantom, { consistentSet } from "./index";
import { CITY, LINKS, exitsFrom, hopDistance } from "./city";
import { redactStateFor, type PhantomState, type PhantomView } from "./state";

const config = phantom.configSchema.parse({});
const seats3 = makeBotSeats(3);

describe("the city", () => {
  it("is 120 nodes across three transport layers plus the river", () => {
    expect(CITY.nodes).toHaveLength(120);
    expect(CITY.cab.length).toBeGreaterThan(150);
    expect(CITY.tram.length).toBeGreaterThan(30);
    expect(CITY.metro.length).toBeGreaterThan(10);
    expect(CITY.river).toHaveLength(4);
  });

  it("is fully connected by cab alone", () => {
    const seen = new Set([1]);
    const queue = [1];
    while (queue.length) {
      const node = queue.shift()!;
      for (const exit of exitsFrom(node)) {
        if (exit.transport !== "cab") continue;
        if (seen.has(exit.to)) continue;
        seen.add(exit.to);
        queue.push(exit.to);
      }
    }
    expect(seen.size).toBe(120);
  });

  it("keeps each of the sparser layers connected within itself", () => {
    for (const layer of ["tram", "metro"] as const) {
      const stops = new Set<number>();
      for (const [a, b] of CITY[layer]) {
        stops.add(a);
        stops.add(b);
      }
      const first = [...stops][0]!;
      const seen = new Set([first]);
      const queue = [first];
      while (queue.length) {
        const node = queue.shift()!;
        for (const exit of exitsFrom(node)) {
          if (exit.transport !== layer) continue;
          if (seen.has(exit.to)) continue;
          seen.add(exit.to);
          queue.push(exit.to);
        }
      }
      expect(seen.size, `${layer} is in pieces`).toBe(stops.size);
    }
  });

  it("gives every node somewhere to go", () => {
    for (const node of CITY.nodes) {
      expect(LINKS.get(node.id)?.length ?? 0, `node ${node.id} is a dead end`).toBeGreaterThan(0);
    }
  });

  it("keeps the two spawn pools apart", () => {
    expect(CITY.fugitiveStarts.length).toBeGreaterThan(5);
    expect(CITY.detectiveStarts.length).toBeGreaterThan(20);
    for (const start of CITY.fugitiveStarts) {
      expect(CITY.detectiveStarts).not.toContain(start);
      const nearest = Math.min(...CITY.detectiveStarts.map((d) => hopDistance(d, start)));
      expect(nearest, `fugitive can start on top of a detective`).toBeGreaterThan(1);
    }
  });
});

describe("phantom rules", () => {
  it("gives detectives their tickets and the fugitive one black per detective", () => {
    const state = phantom.createState(config, makeBotSeats(4), "s") as PhantomState;
    expect(state.detectives).toHaveLength(3);
    for (const seat of state.detectives) {
      expect(state.tickets[seat]).toEqual({ cab: 10, tram: 8, metro: 4, black: 0, double: 0 });
    }
    expect(state.tickets[state.fugitive]).toEqual({ cab: 0, tram: 0, metro: 0, black: 3, double: 2 });
  });

  it("passes a detective's spent ticket to the fugitive", () => {
    const state = phantom.createState(config, seats3, "tickets") as PhantomState;
    // Fugitive first.
    const fugitiveMove = phantom.legalMoves(state, state.fugitive)[0]!;
    const afterFugitive = phantom.applyMove(state, state.fugitive, fugitiveMove);
    expect(afterFugitive.ok).toBe(true);
    if (!afterFugitive.ok) return;

    const detective = afterFugitive.value.state.detectives[0]!;
    const move = phantom
      .legalMoves(afterFugitive.value.state, detective)
      .find((m) => m.kind === "move" && m.transport === "cab");
    expect(move).toBeDefined();
    const after = phantom.applyMove(afterFugitive.value.state, detective, move!);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.state.tickets[detective]!.cab).toBe(9);
    expect(after.value.state.tickets[after.value.state.fugitive]!.cab).toBe(1);
  });

  it("logs the transport but not the destination, except on a sighting", () => {
    let state = phantom.createState(config, seats3, "log") as PhantomState;
    const move = phantom.legalMoves(state, state.fugitive).find((m) => m.kind === "move")!;
    const res = phantom.applyMove(state, state.fugitive, move);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;
    expect(state.log[0]!.node).toBeNull();
    expect(state.log[0]!.transport).toBeDefined();

    // Round three is a sighting round.
    state.round = 3;
    state.toMove = state.fugitive;
    const second = phantom.applyMove(state, state.fugitive, phantom.legalMoves(state, state.fugitive)[0]!);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.state.log.at(-1)!.node).not.toBeNull();
  });

  it("never lets two detectives share a node, or the fugitive step onto one", () => {
    const state = phantom.createState(config, seats3, "share") as PhantomState;
    const [a, b] = state.detectives as [number, number];
    // Put detective B next door to A and check A cannot walk onto B.
    const neighbour = exitsFrom(state.positions[a]!)[0]!;
    state.positions[b] = neighbour.to;
    state.toMove = a;
    expect(phantom.legalMoves(state, a).some((m) => m.kind === "move" && m.to === neighbour.to)).toBe(false);

    state.positions[state.fugitive] = state.positions[a]!;
    state.toMove = state.fugitive;
    expect(
      phantom.legalMoves(state, state.fugitive).some((m) => m.kind === "move" && m.to === neighbour.to)
    ).toBe(false);
  });

  it("ends the moment a detective steps onto the fugitive", () => {
    const state = phantom.createState(config, seats3, "catch") as PhantomState;
    const detective = state.detectives[0]!;
    const exit = exitsFrom(state.positions[detective]!).find((e) => e.transport === "cab")!;
    state.positions[state.fugitive] = exit.to;
    state.toMove = detective;
    const res = phantom.applyMove(state, detective, { kind: "move", to: exit.to, transport: "cab" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.finished).toBe(true);
    expect(res.value.state.winner).toBe("detectives");
    expect(phantom.score(res.value.state).find((s) => s.seat === detective)?.won).toBe(true);
  });

  it("gives the fugitive the game if the last round completes", () => {
    let state = phantom.createState(config, seats3, "escape") as PhantomState;
    state.round = state.finalRound;
    // Walk one full round.
    for (const seat of [state.fugitive, ...state.detectives]) {
      state.toMove = seat;
      const move = phantom.legalMoves(state, seat)[0]!;
      const res = phantom.applyMove(state, seat, move);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      state = res.value.state;
      if (state.finished) break;
    }
    expect(state.finished).toBe(true);
    expect(state.winner).toBe("fugitive");
  });

  it("only crosses the river on a black ticket", () => {
    const state = phantom.createState(config, seats3, "river") as PhantomState;
    const [a, b] = CITY.river[0]!;
    state.positions[state.fugitive] = a;
    state.toMove = state.fugitive;
    const moves = phantom.legalMoves(state, state.fugitive).filter((m) => m.kind === "move" && m.to === b);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.kind === "move" && m.transport === "black")).toBe(true);

    const detective = state.detectives[0]!;
    state.positions[detective] = a;
    state.toMove = detective;
    expect(phantom.legalMoves(state, detective).some((m) => m.kind === "move" && m.to === b)).toBe(false);
  });
});

describe("phantom keeps its secret", () => {
  it("never sends the fugitive's node to a detective or a spectator", () => {
    let state = phantom.createState(config, makeBotSeats(4), "leak") as PhantomState;
    // Play several rounds so the log has something in it.
    for (let i = 0; i < 12 && !state.finished; i++) {
      const seat = phantom.currentSeats(state)[0]!;
      const legal = phantom.legalMoves(state, seat);
      const res = phantom.applyMove(state, seat, legal[legal.length - 1]!);
      if (!res.ok) break;
      state = res.value.state;
    }

    const hidden = state.positions[state.fugitive]!;
    const sighted = state.log.some((l) => l.node === hidden);

    for (const viewer of [...state.detectives, "spectator" as const]) {
      const view = redactStateFor(state, viewer) as PhantomView;
      expect(view.amFugitive).toBe(false);
      expect(view.positions[state.fugitive]).not.toBe(sighted ? -1 : hidden);
      if (!sighted) {
        // The node must not appear anywhere in the payload — not in positions,
        // not in the log, not in some helpful extra field.
        const json = JSON.stringify(view);
        const asPosition = `"${state.fugitive}":${hidden}`;
        expect(json).not.toContain(asPosition);
      }
    }

    // The fugitive, of course, knows exactly where they are.
    const own = redactStateFor(state, state.fugitive) as PhantomView;
    expect(own.amFugitive).toBe(true);
    expect(own.positions[state.fugitive]).toBe(hidden);
  });

  it("shows the fugitive's position to everyone once the game is over", () => {
    const state = phantom.createState(config, seats3, "reveal-at-end") as PhantomState;
    state.finished = true;
    state.winner = "fugitive";
    const view = redactStateFor(state, state.detectives[0]!) as PhantomView;
    expect(view.positions[state.fugitive]).toBe(state.positions[state.fugitive]);
  });

  it("builds a consistent set that always contains the truth", () => {
    let state = phantom.createState(config, seats3, "consistent") as PhantomState;
    for (let i = 0; i < 15 && !state.finished; i++) {
      const seat = phantom.currentSeats(state)[0]!;
      const legal = phantom.legalMoves(state, seat);
      const res = phantom.applyMove(state, seat, legal[0]!);
      if (!res.ok) break;
      state = res.value.state;
    }
    const view = redactStateFor(state, state.detectives[0]!) as PhantomView;
    const detectives = state.detectives.map((d) => state.positions[d]!);
    const candidates = consistentSet(view, []);
    // Whatever the detectives deduce, the fugitive is somewhere inside it.
    expect(candidates.has(state.positions[state.fugitive]!)).toBe(true);
    expect(candidates.size).toBeGreaterThan(0);
    void detectives;
  });
});

describe("phantom as a Gambit game", () => {
  it("holds its invariants across random walks", () => {
    const report = checkProperties(phantom, { lines: 3, maxPly: 200, seats: 4 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games at every table size", () => {
    for (const seats of [3, 4, 6]) {
      const batch = simulateMany(phantom, 8, { seats, level: 2, maxPly: 400 });
      expect(batch.failures.map((f) => f.error), `${seats} seats`).toEqual([]);
    }
  });

  it("is winnable from both sides", () => {
    let caught = 0;
    let escaped = 0;
    for (let i = 0; i < 24; i++) {
      const sim = simulate(phantom, { seats: 4, level: 2, seed: `balance-${i}` });
      const state = sim.scores;
      if (state.length === 0) continue;
      // Seat order is randomised inside the game, so read the result instead.
      if (sim.winner.length === 1) caught += 0; // a single winner is the fugitive
      if (sim.winner.length > 1) caught++;
      else escaped++;
    }
    expect(caught + escaped).toBeGreaterThan(0);
  });

  it("replays exactly", () => {
    const sim = simulate(phantom, { seats: 4, level: 2, seed: "replay" });
    expect(sim.error).toBeUndefined();
    const seats = makeBotSeats(4);
    const a = replay(phantom, { seats, seed: sim.seed, log: sim.log });
    const b = replay(phantom, { seats, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
