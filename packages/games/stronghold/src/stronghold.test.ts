import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import stronghold from "./index";
import {
  BATTLE_ODDS,
  REGIONS,
  TERRITORIES,
  TERRITORY_KEYS,
  byKey,
  isSet,
  makeCardDeck,
  resolveDice,
  setValue,
  territoriesIn
} from "./world";
import { objectiveMet, owned, reinforcementsFor, type StrongholdState, type StrongholdView } from "./state";

const config = stronghold.configSchema.parse({});
const seats3 = makeBotSeats(3);

describe("the world", () => {
  it("is forty-two territories in six regions", () => {
    expect(TERRITORIES).toHaveLength(42);
    expect(REGIONS).toHaveLength(6);
    expect(REGIONS.reduce((n, r) => n + territoriesIn(r.key).length, 0)).toBe(42);
    for (const region of REGIONS) {
      expect(region.bonus).toBeGreaterThanOrEqual(2);
      expect(region.bonus).toBeLessThanOrEqual(7);
    }
  });

  it("has symmetric borders and no territory stranded", () => {
    for (const territory of TERRITORIES) {
      expect(territory.borders.length, `${territory.key} has no borders`).toBeGreaterThan(0);
      for (const border of territory.borders) {
        expect(TERRITORY_KEYS, `${territory.key} → ${border}`).toContain(border);
        expect(byKey(border).borders, `${border} does not border back`).toContain(territory.key);
      }
    }
  });

  it("is one connected world", () => {
    const seen = new Set(["frostgate"]);
    const queue = ["frostgate"];
    while (queue.length) {
      const key = queue.shift()!;
      for (const next of byKey(key).borders) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(42);
  });

  it("connects every region to at least one other", () => {
    for (const region of REGIONS) {
      const outside = territoriesIn(region.key).some((key) =>
        byKey(key).borders.some((b) => byKey(b).region !== region.key)
      );
      expect(outside, `${region.key} is an island`).toBe(true);
    }
  });

  it("deals 44 cards and recognises the two kinds of set", () => {
    const deck = makeCardDeck();
    expect(deck).toHaveLength(44);
    expect(deck.filter((c) => c.symbol === "wild")).toHaveLength(2);

    const three = deck.filter((c) => c.symbol === "spear").slice(0, 3);
    expect(isSet(three)).toBe(true);
    const oneEach = [
      deck.find((c) => c.symbol === "spear")!,
      deck.find((c) => c.symbol === "horse")!,
      deck.find((c) => c.symbol === "engine")!
    ];
    expect(isSet(oneEach)).toBe(true);
    const mixed = [
      deck.filter((c) => c.symbol === "spear")[0]!,
      deck.filter((c) => c.symbol === "spear")[1]!,
      deck.find((c) => c.symbol === "horse")!
    ];
    expect(isSet(mixed)).toBe(false);
  });

  it("escalates set values the way the design says", () => {
    expect([0, 1, 2, 3, 4, 5].map(setValue)).toEqual([4, 6, 8, 10, 12, 15]);
    expect(setValue(6)).toBe(20);
    expect(setValue(7)).toBe(25);
  });
});

describe("combat", () => {
  it("gives ties to the defender", () => {
    expect(resolveDice([6], [6])).toEqual({ attacker: 1, defender: 0 });
    expect(resolveDice([6], [5])).toEqual({ attacker: 0, defender: 1 });
    expect(resolveDice([6, 5], [6, 4])).toEqual({ attacker: 1, defender: 1 });
    expect(resolveDice([6, 6, 5], [1, 2])).toEqual({ attacker: 0, defender: 2 });
  });

  it("has an odds table that matches the known figures", () => {
    // Three against two: the attacker loses about 0.92 armies a round.
    const three = BATTLE_ODDS["3v2"]!;
    expect(three.attackerLoses + three.defenderLoses).toBeCloseTo(2, 5);
    expect(three.defenderLoses).toBeGreaterThan(three.attackerLoses);
    const one = BATTLE_ODDS["1v1"]!;
    expect(one.defenderLoses).toBeCloseTo(15 / 36, 3);
  });
});

describe("stronghold rules", () => {
  it("deals the map out and gives everyone armies to place", () => {
    const state = stronghold.createState(config, seats3, "s") as StrongholdState;
    expect(state.phase).toBe("setup");
    const counts = [0, 1, 2].map((seat) => owned(state, seat).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(42);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (const seat of [0, 1, 2]) expect(state.toPlace[seat]).toBe(35 - counts[seat]!);
  });

  it("puts a neutral force on the map at a two-player table", () => {
    const state = stronghold.createState(config, makeBotSeats(2), "s") as StrongholdState;
    expect(state.neutral).toBe(true);
    const neutral = TERRITORY_KEYS.filter((k) => state.owner[k] === -1);
    expect(neutral.length).toBeGreaterThan(10);
    expect(stronghold.currentSeats(state)).toEqual([0]);
  });

  it("pays one army per three territories, at least three, plus region bonuses", () => {
    const state = stronghold.createState(config, seats3, "s") as StrongholdState;
    for (const key of TERRITORY_KEYS) state.owner[key] = 1;
    for (const key of territoriesIn("coralia")) state.owner[key] = 0;
    expect(reinforcementsFor(state, 0)).toBe(3 + 2); // minimum three, plus Coralia
    expect(reinforcementsFor(state, 1)).toBe(Math.floor(38 / 3) + 5 + 2 + 5 + 3 + 7);
  });

  it("asks how many armies march in after a conquest", () => {
    const state = stronghold.createState(config, seats3, "s") as StrongholdState;
    state.phase = "attack";
    state.turn = 0;
    state.toPlace[0] = 0;
    const from = "khordan";
    const to = byKey(from).borders[0]!;
    state.owner[from] = 0;
    state.armies[from] = 10;
    state.owner[to] = 1;
    state.armies[to] = 1;

    let attempts = 0;
    let after: StrongholdState = state;
    // Roll until the attack actually takes the territory.
    while (attempts < 40 && after.owner[to] !== 0) {
      const res = stronghold.applyMove(after, 0, { kind: "attack", from, to });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      after = res.value.state;
      if (after.pending.length) break;
      after.armies[from] = 10;
      after.armies[to] = 1;
      attempts++;
    }
    expect(after.pending[0]?.kind).toBe("occupy");
    expect(stronghold.legalMoves(after, 0).every((m) => m.kind === "occupy")).toBe(true);
    expect(stronghold.legalMoves(after, 1)).toEqual([]);

    const occupy = stronghold.legalMoves(after, 0)[0]!;
    const moved = stronghold.applyMove(after, 0, occupy);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value.state.pending).toHaveLength(0);
      expect(moved.value.state.armies[to]).toBeGreaterThan(0);
    }
  });

  it("only fortifies along a connected line of your own territories", () => {
    const state = stronghold.createState(config, seats3, "s") as StrongholdState;
    state.phase = "fortify";
    state.turn = 0;
    for (const key of TERRITORY_KEYS) state.owner[key] = 1;
    state.owner.windward = 0;
    state.owner.thornreef = 0;
    state.owner.frostgate = 0;
    state.armies.windward = 5;
    state.armies.thornreef = 1;
    state.armies.frostgate = 1;

    const good = stronghold.applyMove(state, 0, { kind: "fortify", from: "windward", to: "thornreef", count: 2 });
    expect(good.ok).toBe(true);

    const bad = stronghold.applyMove(state, 0, { kind: "fortify", from: "windward", to: "frostgate", count: 2 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toMatch(/no line/i);
  });

  it("hands a beaten player's cards to whoever finished them", () => {
    const state = stronghold.createState(config, seats3, "s") as StrongholdState;
    state.phase = "attack";
    state.turn = 0;
    state.toPlace[0] = 0;
    for (const key of TERRITORY_KEYS) state.owner[key] = 2;
    const last = "thornreef";
    const attacker = byKey(last).borders[0]!;
    state.owner[last] = 1;
    state.armies[last] = 1;
    state.owner[attacker] = 0;
    state.armies[attacker] = 12;
    state.hands[1] = [1, 2, 3];

    let after: StrongholdState = state;
    for (let i = 0; i < 40 && after.owner[last] !== 0; i++) {
      const res = stronghold.applyMove(after, 0, { kind: "attack", from: attacker, to: last });
      if (!res.ok) break;
      after = res.value.state;
      if (after.owner[last] === 0) break;
      after.armies[attacker] = 12;
      after.armies[last] = 1;
    }
    expect(after.eliminated).toContain(1);
    expect(after.hands[0]).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(after.hands[1]).toEqual([]);
  });

  it("recognises a completed objective", () => {
    const state = stronghold.createState(config, seats3, "s") as StrongholdState;
    state.objectives[0] = { kind: "regions", regions: ["coralia", "sunder"] };
    expect(objectiveMet(state, 0)).toBe(false);
    for (const key of [...territoriesIn("coralia"), ...territoriesIn("sunder")]) state.owner[key] = 0;
    expect(objectiveMet(state, 0)).toBe(true);

    state.objectives[1] = { kind: "territories", count: 24 };
    expect(objectiveMet(state, 1)).toBe(false);
  });
});

describe("stronghold as a Gambit game", () => {
  it("keeps objectives and hands secret", () => {
    const state = stronghold.createState(config, seats3, "objectives") as StrongholdState;
    state.hands[1] = [7, 8];
    const view = stronghold.redactStateFor(state, 0) as StrongholdView;
    expect(view.objective).toEqual(state.objectives[0]);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(state.objectives[1]));
    expect(view.hand.every((c) => (state.hands[0] ?? []).includes(c.id))).toBe(true);
    expect(view.handCounts[1]).toBe(2);
    expect(view).not.toHaveProperty("deck");
    expect(view).not.toHaveProperty("objectives");
  });

  it("holds its invariants across random walks", () => {
    const report = checkProperties(stronghold, { lines: 3, maxPly: 300, seats: 3 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games in both modes and at every table size", () => {
    for (const mode of ["objectives", "conquest"]) {
      for (const seats of [2, 4, 6]) {
        const batch = simulateMany(stronghold, 4, { seats, level: 2, config: { mode }, maxPly: 6000 });
        expect(batch.failures.map((f) => f.error), `${mode} @ ${seats}`).toEqual([]);
      }
    }
  });

  it("replays exactly, dice and all", () => {
    const sim = simulate(stronghold, { seats: 3, level: 2, seed: "replay" });
    expect(sim.error).toBeUndefined();
    const a = replay(stronghold, { seats: seats3, seed: sim.seed, log: sim.log });
    const b = replay(stronghold, { seats: seats3, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
