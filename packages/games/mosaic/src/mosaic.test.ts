import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import mosaic from "./index";
import {
  FLOOR_PENALTIES,
  endBonus,
  factoryCount,
  scoreTile,
  wallColumnFor,
  type MosaicState,
  type MosaicView,
  type PlayerBoard
} from "./state";

const config = mosaic.configSchema.parse({});
const seats2 = makeBotSeats(2);

function emptyBoard(): PlayerBoard {
  return {
    rows: Array.from({ length: 5 }, () => ({ colour: null, count: 0 })),
    wall: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => false)),
    floor: [],
    score: 0
  };
}

describe("mosaic setup", () => {
  it("puts five factories out for two players and four tiles on each", () => {
    const state = mosaic.createState(config, seats2, "s") as MosaicState;
    expect(factoryCount(2)).toBe(5);
    expect(state.factories).toHaveLength(5);
    for (const f of state.factories) expect(f).toHaveLength(4);
    expect(state.bag).toHaveLength(100 - 20);
  });

  it("lays the wall out as a Latin square", () => {
    for (let row = 0; row < 5; row++) {
      const cols = new Set(Array.from({ length: 5 }, (_, colour) => wallColumnFor(row, colour as 0)));
      expect(cols.size).toBe(5); // every colour has its own column in a row
    }
    for (let colour = 0; colour < 5; colour++) {
      const cols = new Set(Array.from({ length: 5 }, (_, row) => wallColumnFor(row, colour as 0)));
      expect(cols.size).toBe(5); // and a different column in every row
    }
  });
});

describe("mosaic scoring", () => {
  it("scores a lone tile one, and a chain its length in both directions", () => {
    const board = emptyBoard();
    board.wall[2]![2] = true;
    expect(scoreTile(board, 2, 2)).toBe(1);

    board.wall[2]![1] = true;
    board.wall[2]![3] = true;
    expect(scoreTile(board, 2, 2)).toBe(3);

    board.wall[1]![2] = true;
    // three across plus two down
    expect(scoreTile(board, 2, 2)).toBe(5);
  });

  it("pays the end bonuses for rows, columns and colours", () => {
    const board = emptyBoard();
    board.wall[0] = [true, true, true, true, true];
    expect(endBonus(board)).toBe(2);

    const full = emptyBoard();
    full.wall = full.wall.map(() => [true, true, true, true, true]);
    // 5 rows (10) + 5 columns (35) + 5 colours (50)
    expect(endBonus(full)).toBe(95);
  });

  it("takes points off for the floor, but never below zero", () => {
    let state = mosaic.createState(config, seats2, "s") as MosaicState;
    // Force a round end with a heavy floor and nothing on the wall.
    state.factories = [[0, 0, 0, 0]];
    state.centre = [];
    state.boards[0]!.floor = [];
    const res = mosaic.applyMove(state, 0, { kind: "take", source: 0, colour: 0, row: -1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.value.state;
    expect(state.boards[0]!.score).toBe(0);
    expect(FLOOR_PENALTIES.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(-6);
  });
});

describe("mosaic rules", () => {
  it("slides the leftovers into the middle when a factory is emptied", () => {
    const state = mosaic.createState(config, seats2, "s") as MosaicState;
    state.factories[0] = [0, 0, 1, 2];
    const res = mosaic.applyMove(state, 0, { kind: "take", source: 0, colour: 0, row: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.factories[0]).toEqual([]);
    expect(res.value.state.centre.sort()).toEqual([1, 2]);
  });

  it("hands the first-player token to whoever dips into the middle first", () => {
    const state = mosaic.createState(config, seats2, "s") as MosaicState;
    state.centre = [3, 3];
    const res = mosaic.applyMove(state, 0, { kind: "take", source: -1, colour: 3, row: 2 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.tokenInCentre).toBe(false);
    expect(res.value.state.nextStarter).toBe(0);
    expect(res.value.state.boards[0]!.floor).toContain(-1);
  });

  it("refuses a colour that is already on the wall in that row", () => {
    const state = mosaic.createState(config, seats2, "s") as MosaicState;
    state.factories[0] = [1, 1, 1, 1];
    state.boards[0]!.wall[0]![wallColumnFor(0, 1)] = true;
    const res = mosaic.applyMove(state, 0, { kind: "take", source: 0, colour: 1, row: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/already on your wall/i);
  });

  it("refuses to mix two colours in one row", () => {
    const state = mosaic.createState(config, seats2, "s") as MosaicState;
    state.factories[0] = [1, 1, 1, 1];
    state.boards[0]!.rows[3] = { colour: 2, count: 1 };
    const res = mosaic.applyMove(state, 0, { kind: "take", source: 0, colour: 1, row: 3 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/one colour/i);
  });

  it("overflows onto the floor when the row can't hold them all", () => {
    const state = mosaic.createState(config, seats2, "s") as MosaicState;
    state.factories[0] = [1, 1, 1, 1];
    state.factories[1] = [2, 3, 4, 0]; // keeps the round alive
    const res = mosaic.applyMove(state, 0, { kind: "take", source: 0, colour: 1, row: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.boards[0]!.floor.filter((t) => t === 1)).toHaveLength(3);
  });

  it("tiles the wall and starts a fresh round once the table is empty", () => {
    const state = mosaic.createState(config, seats2, "s") as MosaicState;
    state.factories = [[1, 1, 1, 1]];
    state.centre = [];
    state.boards[0]!.rows[0] = { colour: null, count: 0 };
    const res = mosaic.applyMove(state, 0, { kind: "take", source: 0, colour: 1, row: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.value.state;
    expect(after.boards[0]!.wall[0]![wallColumnFor(0, 1)]).toBe(true);
    expect(after.round).toBe(2);
    expect(after.factories.length).toBe(factoryCount(2));
  });
});

describe("mosaic as a Gambit game", () => {
  it("keeps a hundred tiles accounted for at all times", () => {
    const report = checkProperties(mosaic, { lines: 4, maxPly: 300, seats: 2 });
    expect(report.violations).toEqual([]);
  });

  it("hides the bag but shows every board", () => {
    const state = mosaic.createState(config, makeBotSeats(3), "s") as MosaicState;
    const view = mosaic.redactStateFor(state, 0) as MosaicView;
    expect(view).not.toHaveProperty("bag");
    expect(view.bagCount).toBe(state.bag.length);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(state.bag.slice(0, 8)));
    expect(Object.keys(view.boards)).toHaveLength(3);
  });

  it("finishes bot games at every table size", () => {
    for (const seats of [2, 3, 4]) {
      const batch = simulateMany(mosaic, 25, { seats, level: 2, maxPly: 1200 });
      expect(batch.failures.map((f) => f.error)).toEqual([]);
      expect(batch.ok).toBe(25);
    }
  });

  it("produces sensible scores rather than runaway ones", () => {
    const sim = simulate(mosaic, { seats: 3, level: 3, seed: "scores" });
    expect(sim.terminal).toBe(true);
    for (const s of sim.scores) {
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(s.total).toBeLessThan(200);
    }
  });

  it("replays exactly", () => {
    const sim = simulate(mosaic, { seats: 2, level: 2, seed: "replay" });
    const a = replay(mosaic, { seats: seats2, seed: sim.seed, log: sim.log });
    const b = replay(mosaic, { seats: seats2, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
