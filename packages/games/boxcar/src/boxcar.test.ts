import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import boxcar from "./index";
import { MAPS, longestTrail, makeTrainDeck, routePoints, shortestPath } from "./maps";
import { bestNetwork, fullScores, handSize, mapOf, paymentsFor, type BoxcarState, type BoxcarView } from "./state";

const seats2 = makeBotSeats(2);
const config = boxcar.configSchema.parse({});

/** Push a fresh state past the opening ticket draft. */
function drafted(seats = seats2, cfg = config, seed = "s"): BoxcarState {
  let state = boxcar.createState(cfg, seats, seed) as BoxcarState;
  for (const s of seats) {
    const keep = boxcar.legalMoves(state, s.id).find((m) => m.kind === "keep" && m.ids.length === 2);
    if (!keep) throw new Error("the opening draft offered nothing to keep");
    const res = boxcar.applyMove(state, s.id, keep);
    if (!res.ok) throw new Error(res.error.message);
    state = res.value.state;
  }
  return state;
}

describe("the maps", () => {
  it("ships all three at the sizes the design calls for", () => {
    expect(MAPS.continental!.cities).toHaveLength(33);
    expect(MAPS.continental!.routes).toHaveLength(59);
    expect(MAPS.frontier!.cities).toHaveLength(33);
    expect(MAPS.frontier!.routes).toHaveLength(89);
    expect(MAPS.subcontinent!.cities).toHaveLength(26);
    expect(MAPS.subcontinent!.routes).toHaveLength(47);
  });

  it("is one connected network per map, with every ticket solvable", () => {
    for (const map of Object.values(MAPS)) {
      const first = map.cities[0]!.key;
      for (const city of map.cities) {
        expect(shortestPath(map, first, city.key), `${map.id}: ${city.key} is stranded`).toBeLessThan(Infinity);
      }
      for (const ticket of map.tickets) {
        expect(shortestPath(map, ticket.a, ticket.b), `${map.id}: ${ticket.a}→${ticket.b}`).toBeLessThan(Infinity);
      }
    }
  });

  it("prices every ticket within one point of its shortest path", () => {
    const off: string[] = [];
    for (const map of Object.values(MAPS)) {
      for (const ticket of map.tickets) {
        const path = shortestPath(map, ticket.a, ticket.b);
        if (Math.abs(path - ticket.points) > 1) {
          off.push(`${map.id} ${ticket.a}→${ticket.b}: ${ticket.points}pts vs path ${path}`);
        }
      }
    }
    expect(off).toEqual([]);
  });

  it("keeps every ticket inside a single player's car supply", () => {
    for (const map of Object.values(MAPS)) {
      for (const ticket of map.tickets) {
        expect(shortestPath(map, ticket.a, ticket.b)).toBeLessThanOrEqual(45 * 0.6);
      }
    }
  });

  it("has tunnels, ferries and doubles where the design says", () => {
    expect(MAPS.continental!.routes.filter((r) => r.tunnel).length).toBeGreaterThan(0);
    expect(MAPS.continental!.routes.filter((r) => r.ferry > 0).length).toBeGreaterThan(0);
    expect(MAPS.continental!.stations).toBe(true);
    expect(MAPS.frontier!.stations).toBe(false);
    expect(MAPS.frontier!.routes.filter((r) => r.twin !== undefined).length).toBeGreaterThan(20);
    expect(MAPS.subcontinent!.routes.filter((r) => r.ferry > 0).length).toBe(1);
  });

  it("deals 110 train cards, 14 of them locomotives", () => {
    const deck = makeTrainDeck();
    expect(deck).toHaveLength(110);
    expect(deck.filter((c) => c === "loco")).toHaveLength(14);
  });

  it("pays the published route points", () => {
    expect([1, 2, 3, 4, 5, 6, 8].map(routePoints)).toEqual([1, 2, 4, 7, 10, 15, 21]);
  });
});

describe("boxcar setup", () => {
  it("opens with a simultaneous draft of one long and three regular tickets", () => {
    const state = boxcar.createState(config, seats2, "s") as BoxcarState;
    expect(boxcar.currentSeats(state).sort()).toEqual([0, 1]);
    expect(state.offered[0]).toHaveLength(4);
    expect(mapOf(state).tickets[state.offered[0]![0]!]!.long).toBe(true);
    const moves = boxcar.legalMoves(state, 0);
    expect(moves.every((m) => m.kind === "keep" && m.ids.length >= 2)).toBe(true);
  });

  it("deals four cards each and never shows three locomotives face up", () => {
    for (let i = 0; i < 40; i++) {
      const state = boxcar.createState(config, seats2, `seed-${i}`) as BoxcarState;
      expect(handSize(state.hands[0]!)).toBe(4);
      expect(state.market.filter((c) => c === "loco").length).toBeLessThan(3);
    }
  });

  it("sends rejected long tickets out of the game and regular ones back", () => {
    const state = boxcar.createState(config, seats2, "s") as BoxcarState;
    const offered = state.offered[0]!;
    const longId = offered.find((id) => mapOf(state).tickets[id]!.long)!;
    const keep = offered.filter((id) => id !== longId).slice(0, 2);
    const before = state.ticketDeck.length;
    const res = boxcar.applyMove(state, 0, { kind: "keep", ids: keep });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.ticketDeck).toHaveLength(before + 1);
    expect(res.value.state.longDeck.includes(longId)).toBe(false);
  });
});

describe("boxcar turns", () => {
  it("makes a face-up locomotive cost both draws", () => {
    let state = drafted();
    state.market = ["loco", "red", "blue", "green", "white"];
    state.turn = 0;
    const before = state.hands[0]!.loco;
    const res = boxcar.applyMove(state, 0, { kind: "draw", from: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;
    expect(state.hands[0]!.loco).toBe(before + 1);
    expect(state.turn).toBe(1);
  });

  it("refuses a face-up locomotive as the second draw", () => {
    let state = drafted();
    state.market = ["red", "loco", "blue", "green", "white"];
    state.turn = 0;
    const first = boxcar.applyMove(state, 0, { kind: "draw", from: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.value.state;
    expect(state.drawsLeft).toBe(1);
    expect(boxcar.legalMoves(state, 0).some((m) => m.kind === "draw" && m.from === 1)).toBe(false);
    const second = boxcar.applyMove(state, 0, { kind: "draw", from: 1 });
    expect(second.ok).toBe(false);
  });

  it("claims a route, pays for it, and scores it immediately", () => {
    let state = drafted();
    const map = mapOf(state);
    const route = map.routes.find((r) => r.color === "blue" && !r.tunnel && r.ferry === 0)!;
    state.hands[0]! = { ...state.hands[0]!, blue: route.len };
    state.turn = 0;

    const res = boxcar.applyMove(state, 0, { kind: "claim", route: route.id, colour: "blue", locos: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;
    expect(state.claims[route.id]).toBe(0);
    expect(state.routeScore[0]).toBe(routePoints(route.len));
    expect(state.cars[0]).toBe(45 - route.len);
    expect(state.hands[0]!.blue).toBe(0);
  });

  it("insists on locomotives for a ferry", () => {
    const state = drafted();
    const map = mapOf(state);
    const ferry = map.routes.find((r) => r.ferry > 0)!;
    state.hands[0]! = { ...state.hands[0]!, red: 9, loco: 0 };
    state.turn = 0;
    const res = boxcar.applyMove(state, 0, { kind: "claim", route: ferry.id, colour: "red", locos: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/locomotive/i);
  });

  it("lets a tunnel demand more, and lets the player back out", () => {
    const state = drafted();
    const map = mapOf(state);
    const tunnel = map.routes.find((r) => r.tunnel && r.ferry === 0)!;
    const colour = (tunnel.color === "gray" ? "red" : tunnel.color) as "red";
    state.hands[0]! = { ...state.hands[0]!, [colour]: 12, loco: 4 };
    state.deck = [colour, colour, colour, ...state.deck];
    state.turn = 0;

    const claim = boxcar.applyMove(state, 0, { kind: "claim", route: tunnel.id, colour, locos: 0 });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    const pendingState = claim.value.state;
    expect(pendingState.tunnel?.extra).toBe(3);
    expect(pendingState.claims[tunnel.id]).toBeUndefined();
    expect(boxcar.currentSeats(pendingState)).toEqual([0]);

    const before = pendingState.hands[0]![colour];
    const out = boxcar.applyMove(pendingState, 0, { kind: "tunnel-withdraw" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.state.hands[0]![colour]).toBe(before + tunnel.len);
    expect(out.value.state.claims[tunnel.id]).toBeUndefined();
    expect(out.value.state.turn).toBe(1);

    const paid = boxcar.applyMove(pendingState, 0, { kind: "tunnel-pay", locos: 0 });
    expect(paid.ok).toBe(true);
    if (paid.ok) expect(paid.value.state.claims[tunnel.id]).toBe(0);
  });

  it("closes the second track of a double at a small table", () => {
    const state = drafted();
    const map = mapOf(state);
    const double = map.routes.find((r) => r.twin !== undefined)!;
    state.claims[double.id] = 1;
    state.turn = 0;
    state.hands[0]! = { ...state.hands[0]!, red: 9, loco: 6 };
    const twin = map.routes[double.twin!]!;
    const res = boxcar.applyMove(state, 0, {
      kind: "claim",
      route: twin.id,
      colour: twin.color === "gray" ? "red" : twin.color,
      locos: 0
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/only one track/i);
  });

  it("never lets one player own both tracks of a double, even at five", () => {
    const state = drafted(makeBotSeats(5), config, "five");
    const map = mapOf(state);
    const double = map.routes.find((r) => r.twin !== undefined)!;
    state.claims[double.id] = 0;
    state.turn = 0;
    state.hands[0]! = { ...state.hands[0]!, red: 9, loco: 6 };
    const twin = map.routes[double.twin!]!;
    const res = boxcar.applyMove(state, 0, {
      kind: "claim",
      route: twin.id,
      colour: twin.color === "gray" ? "red" : twin.color,
      locos: 0
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/both tracks/i);
  });

  it("starts the final lap when a player is down to two cars", () => {
    let state = drafted();
    const map = mapOf(state);
    const route = map.routes.find((r) => r.len === 2 && !r.tunnel && r.ferry === 0)!;
    const colour = (route.color === "gray" ? "red" : route.color) as "red";
    state.cars[0] = 4;
    state.hands[0]! = { ...state.hands[0]!, [colour]: 4 };
    state.turn = 0;
    const res = boxcar.applyMove(state, 0, { kind: "claim", route: route.id, colour, locos: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;
    expect(state.finalLap).toBe(true);
    expect(state.finished).toBe(false);
    expect(state.finalTurns).toBe(1);
  });
});

describe("boxcar scoring", () => {
  it("counts the longest continuous trail, revisiting cities but not routes", () => {
    const map = MAPS.continental!;
    const chain = [
      map.routes.find((r) => r.a === "lisbon" && r.b === "madrid")!.id,
      map.routes.find((r) => r.a === "madrid" && r.b === "pamplona")!.id,
      map.routes.find((r) => r.a === "pamplona" && r.b === "paris")!.id
    ];
    expect(longestTrail(map, chain)).toBe(3 + 3 + 4);
  });

  it("lets a station borrow one neighbour's route to finish a ticket", () => {
    const state = drafted();
    const map = mapOf(state);
    // Seat 0 owns both ends of the Lisbon–Paris line; seat 1 owns the middle.
    const lm = map.routes.find((r) => r.a === "lisbon" && r.b === "madrid")!;
    const mp = map.routes.find((r) => r.a === "madrid" && r.b === "pamplona")!;
    const pp = map.routes.find((r) => r.a === "pamplona" && r.b === "paris")!;
    state.claims[lm.id] = 0;
    state.claims[pp.id] = 0;
    state.claims[mp.id] = 1;
    const ticket = map.tickets.find((t) => t.a === "lisbon" && t.b === "paris")!;
    state.tickets[0] = [ticket.id];

    // Without a station the line has a hole in it and the ticket fails.
    expect(bestNetwork(state, 0).routeIds.sort()).toEqual([lm.id, pp.id].sort());
    expect(bestNetwork(state, 0).net).toBe(-ticket.points);

    // A station at Madrid borrows the one route it needs.
    state.stationCities[0] = ["madrid"];
    state.stationsLeft[0] = 2;
    const borrowed = bestNetwork(state, 0);
    expect(borrowed.routeIds).toContain(mp.id);
    expect(borrowed.net).toBe(ticket.points);
  });

  it("pays four points for every station left unbuilt", () => {
    const state = drafted();
    state.tickets[0] = [];
    state.finished = true;
    const detail = fullScores(state);
    expect(detail[0]!.stations).toBe(12);
  });

  it("takes points off for a ticket that was never connected", () => {
    const state = drafted();
    const map = mapOf(state);
    state.tickets[0] = [map.tickets[0]!.id];
    state.finished = true;
    const detail = fullScores(state);
    expect(detail[0]!.ticketPenalty).toBe(map.tickets[0]!.points);
  });
});

describe("boxcar as a Gambit game", () => {
  it("never shows one player another player's hand or tickets", () => {
    const state = drafted(makeBotSeats(3), config, "leak");
    state.hands[1]! = { ...state.hands[1]!, red: 7 };
    const view = boxcar.redactStateFor(state, 0) as BoxcarView;
    const json = JSON.stringify(view);

    expect(view.hand).toEqual(state.hands[0]);
    expect(json).not.toContain(JSON.stringify(state.hands[1]));
    expect(view).not.toHaveProperty("hands");
    expect(view).not.toHaveProperty("deck");
    expect(view.tickets.every((t) => (state.tickets[0] ?? []).includes(t.id))).toBe(true);
    expect(view.ticketCounts[1]).toBe((state.tickets[1] ?? []).length);
    expect(view.deckCount).toBe(state.deck.length);
  });

  it("holds its invariants across random walks", () => {
    const report = checkProperties(boxcar, { lines: 3, maxPly: 250, seats: 2 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games on every map and table size", () => {
    for (const map of ["continental", "frontier", "subcontinent"]) {
      for (const seats of [2, 4]) {
        const batch = simulateMany(boxcar, 6, {
          seats,
          level: 2,
          config: { map, cars: "20" },
          maxPly: 4000
        });
        expect(batch.failures.map((f) => f.error), `${map} @ ${seats}`).toEqual([]);
      }
    }
  });

  it("ends when the map runs out before the cars do", () => {
    // Five players on a 59-route map can claim the lot while everyone still has
    // cars in hand. When a whole lap can do nothing, the line is finished.
    const state = drafted(makeBotSeats(5), config, "exhausted");
    const map = mapOf(state);
    // Spread the claims round the table the way a real game would.
    map.routes.forEach((route, i) => {
      state.claims[route.id] = i % 5;
    });
    state.deck = [];
    state.discard = [];
    state.market = [null, null, null, null, null];
    state.ticketDeck = [];
    for (const seat of [0, 1, 2, 3, 4]) state.stationsLeft[seat] = 0;
    state.turn = 0;

    let current = state;
    for (let i = 0; i < 5; i++) {
      const legal = boxcar.legalMoves(current, current.turn);
      expect(legal.map((m) => m.kind)).toEqual(["pass"]);
      const res = boxcar.applyMove(current, current.turn, { kind: "pass" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      current = res.value.state;
      if (current.finished) break;
    }
    expect(current.finished).toBe(true);
    // And it still scores properly rather than just stopping.
    expect(boxcar.score(current)).toHaveLength(5);
  });

  it("finishes bot games at a full table, where the map is the constraint", () => {
    const batch = simulateMany(boxcar, 6, { seats: 5, level: 1, maxPly: 6000 });
    expect(batch.failures.map((f) => f.error ?? "did not terminate")).toEqual([]);
  });

  it("replays exactly", () => {
    const sim = simulate(boxcar, { seats: 2, level: 2, seed: "replay", config: { cars: "20" } });
    expect(sim.error).toBeUndefined();
    const a = replay(boxcar, { seats: seats2, seed: sim.seed, config: { cars: "20" }, log: sim.log });
    const b = replay(boxcar, { seats: seats2, seed: sim.seed, config: { cars: "20" }, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("offers payments the hand can actually make", () => {
    const state = drafted();
    state.hands[0]! = { ...state.hands[0]!, red: 2, loco: 1 };
    const map = mapOf(state);
    const route = map.routes.find((r) => r.color === "gray" && r.len === 3 && r.ferry === 0 && !r.tunnel)!;
    const options = paymentsFor(state, 0, route.id);
    expect(options.find((o) => o.colour === "red")).toEqual({ colour: "red", locos: 1 });
  });
});
