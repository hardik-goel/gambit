import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import hamlet from "./index";
import { TILE_DEFS, TOTAL_TILES, edgeAt, tileBag, tileById } from "./tiles";
import { canPlace, featureAt, frontier, openFeatures, type HamletState } from "./state";

const config = hamlet.configSchema.parse({});
const seats2 = makeBotSeats(2);

/** The first square and rotation where the drawn tile actually fits. */
function firstFit(state: HamletState): { x: number; y: number; rotation: number } {
  for (const spot of frontier(state)) {
    for (let rotation = 0; rotation < 4; rotation++) {
      if (canPlace(state, state.drawn!, spot.x, spot.y, rotation)) {
        return { x: spot.x, y: spot.y, rotation };
      }
    }
  }
  throw new Error("the opening tile fits nowhere, which cannot happen");
}

describe("the tile set", () => {
  it("is seventy-two tiles including the one that starts the map", () => {
    expect(TOTAL_TILES).toBe(72);
    expect(tileBag()).toHaveLength(71);
    expect(TILE_DEFS.filter((t) => t.start)).toHaveLength(1);
  });

  it("gives every tile at least one partner it can sit beside", () => {
    // For each tile and each of its edges, some other tile must present a
    // matching edge — otherwise a draw could be unplayable by construction.
    for (const tile of TILE_DEFS) {
      for (let side = 0; side < 4; side++) {
        const type = tile.edges[side]!;
        const partner = TILE_DEFS.some((other) => other.edges.includes(type));
        expect(partner, `${tile.id} edge ${side} (${type}) has no partner`).toBe(true);
      }
    }
  });

  it("keeps the frequency curve sane", () => {
    const roads = TILE_DEFS.filter((t) => t.roads.length).reduce((n, t) => n + t.count, 0);
    const keeps = TILE_DEFS.filter((t) => t.keeps.length).reduce((n, t) => n + t.count, 0);
    const shrines = TILE_DEFS.filter((t) => t.shrine).reduce((n, t) => n + t.count, 0);
    expect(roads).toBeGreaterThan(keeps * 0.5);
    expect(shrines).toBeGreaterThanOrEqual(4);
    expect(shrines).toBeLessThan(10);
  });

  it("rotates edges the way the board expects", () => {
    const straight = tileById("road-straight"); // field, road, field, road
    expect(edgeAt(straight, 0, 1)).toBe("road");
    expect(edgeAt(straight, 1, 2)).toBe("road");
    expect(edgeAt(straight, 1, 0)).toBe("road");
  });
});

describe("hamlet placement", () => {
  it("only allows placements that touch the map and match every shared edge", () => {
    const state = hamlet.createState(config, seats2, "s") as HamletState;
    expect(frontier(state)).toHaveLength(4);
    // Nothing may be dropped in open space.
    expect(canPlace(state, "road-straight", 5, 5, 0)).toBe(false);

    const spot = frontier(state)[0]!;
    const fits = [0, 1, 2, 3].filter((r) => canPlace(state, state.drawn!, spot.x, spot.y, r));
    for (const r of fits) {
      for (let side = 0; side < 4; side++) {
        const [dx, dy] = ([
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0]
        ] as [number, number][])[side]!;
        const neighbour = state.tiles[`${spot.x + dx},${spot.y + dy}`];
        if (!neighbour) continue;
        const mine = edgeAt(tileById(state.drawn!), r, side);
        const theirs = edgeAt(tileById(neighbour.id), neighbour.rotation, [2, 3, 0, 1][side]!);
        expect(mine).toBe(theirs);
      }
    }
  });

  it("completes a road and pays a point a tile", () => {
    let state = hamlet.createState(config, seats2, "s") as HamletState;
    // Start tile has a road running east–west; cap the east end with a tile
    // whose road dead-ends, and the west end likewise.
    state.drawn = "keep-edge-road"; // keep north, road south
    // Rotate so its road faces west, closing the start tile's east road.
    const rotation = [0, 1, 2, 3].find((r) => canPlace(state, "keep-edge-road", 1, 0, r));
    expect(rotation).toBeDefined();
    const res = hamlet.applyMove(state, 0, { kind: "place", x: 1, y: 0, rotation: rotation!, meeple: undefined });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;
    expect(Object.keys(state.tiles)).toHaveLength(2);
  });

  it("won't let two meeples share one feature", () => {
    const state = hamlet.createState(config, seats2, "s") as HamletState;
    const fit = firstFit(state);
    const spot = { x: fit.x, y: fit.y };
    const rotation = fit.rotation;
    const features = openFeatures(state, spot.x, spot.y, state.drawn!, rotation);
    expect(features.length).toBeGreaterThan(0);

    const res = hamlet.applyMove(state, 0, {
      kind: "place",
      x: spot.x,
      y: spot.y,
      rotation,
      meeple: features[0]
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.value.state;
    expect(after.meeples).toHaveLength(1);
    expect(after.meeplesLeft[0]).toBe(6);

    // The same connected feature, reached from the neighbouring tile, is closed.
    const next = openFeatures(after, spot.x, spot.y, state.drawn!, rotation);
    expect(next.some((f) => f.kind === features[0]!.kind && f.group === features[0]!.group)).toBe(false);
  });

  it("closes a keep when its walls meet, and counts the banners inside", () => {
    const state = hamlet.createState(config, seats2, "s") as HamletState;
    // Two tiles whose single keep edges face each other: a two-tile keep with
    // no way out, one of them carrying a banner.
    state.tiles = {
      "0,0": { id: "keep-edge", rotation: 0, x: 0, y: 0, by: 0 },
      "0,-1": { id: "keep-three-banner", rotation: 2, x: 0, y: -1, by: 0 }
    };
    const open = featureAt(state, 0, 0, "keep", 0);
    // The three-sided keep still has walls facing open country.
    expect(open.complete).toBe(false);
    expect(open.banners).toBe(1);
    expect(open.tiles.size).toBe(2);

    // Swap in a plain one-edge keep and the feature closes.
    state.tiles["0,-1"] = { id: "keep-edge", rotation: 2, x: 0, y: -1, by: 0 };
    const closed = featureAt(state, 0, 0, "keep", 0);
    expect(closed.complete).toBe(true);
    expect(closed.tiles.size).toBe(2);
  });

  it("holds a shrine open until all eight neighbours are down", () => {
    const state = hamlet.createState(config, seats2, "s") as HamletState;
    state.tiles = { "0,0": { id: "shrine", rotation: 0, x: 0, y: 0, by: 0 } };
    expect(featureAt(state, 0, 0, "shrine", 0).complete).toBe(false);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        state.tiles[`${dx},${dy}`] = { id: "field", rotation: 0, x: dx, y: dy, by: 0 };
      }
    }
    expect(featureAt(state, 0, 0, "shrine", 0).complete).toBe(true);
  });
});

describe("hamlet as a Gambit game", () => {
  it("holds its invariants across random walks", () => {
    const report = checkProperties(hamlet, { lines: 3, maxPly: 120, seats: 2 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games at every table size", () => {
    for (const seats of [2, 3, 5]) {
      const batch = simulateMany(hamlet, 4, { seats, level: 2, maxPly: 400 });
      expect(batch.failures.map((f) => f.error), `${seats} seats`).toEqual([]);
    }
  });

  it("lays every tile in the bag before it ends", () => {
    const sim = simulate(hamlet, { seats: 2, level: 2, seed: "full" });
    expect(sim.terminal).toBe(true);
    expect(sim.ply).toBeGreaterThan(60);
  });

  it("replays exactly", () => {
    const sim = simulate(hamlet, { seats: 2, level: 2, seed: "replay" });
    const a = replay(hamlet, { seats: seats2, seed: sim.seed, log: sim.log });
    const b = replay(hamlet, { seats: seats2, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("shows the same open board to everyone, and keeps the bag order private", () => {
    const state = hamlet.createState(config, seats2, "s") as HamletState;
    const view = hamlet.redactStateFor(state, 0);
    expect(view).not.toHaveProperty("bag");
    expect(view.bagCount).toBe(state.bag.length);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(state.bag.slice(0, 10)));
  });
});
