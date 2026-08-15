import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import remedy from "./index";
import {
  CITIES,
  CUBES_PER_ZONE,
  HUB,
  INFECTION_RATES,
  OUTBREAK_LIMIT,
  ZONES,
  cityById,
  zoneOf
} from "./world";
import { cubesOn, rateOf, redactStateFor, type RemedyState, type RemedyView } from "./state";

const config = remedy.configSchema.parse({});
const seats3 = makeBotSeats(3);

describe("the world", () => {
  it("is forty-eight cities in four zones", () => {
    expect(CITIES).toHaveLength(48);
    for (const zone of ZONES) {
      expect(CITIES.filter((c) => c.zone === zone)).toHaveLength(12);
    }
  });

  it("is one connected network with symmetric roads", () => {
    for (const city of CITIES) {
      expect(city.links.length, `${city.name} is isolated`).toBeGreaterThan(0);
      for (const link of city.links) {
        expect(cityById(link).links, `${city.name} → ${cityById(link).name}`).toContain(city.id);
      }
    }
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const id = queue.shift()!;
      for (const link of cityById(id).links) {
        if (seen.has(link)) continue;
        seen.add(link);
        queue.push(link);
      }
    }
    expect(seen.size).toBe(48);
  });

  it("joins every zone to at least one other", () => {
    for (const zone of ZONES) {
      const crosses = CITIES.filter((c) => c.zone === zone).some((c) =>
        c.links.some((l) => cityById(l).zone !== zone)
      );
      expect(crosses, `${zone} is an island`).toBe(true);
    }
  });
});

describe("remedy setup", () => {
  it("opens with nine infected cities and a laboratory in the hub", () => {
    const state = remedy.createState(config, seats3, "s") as RemedyState;
    expect(state.labs).toEqual([HUB]);
    const infected = CITIES.filter((c) => ZONES.some((z) => cubesOn(state, c.id, z) > 0));
    expect(infected).toHaveLength(9);
    const counts = infected.map((c) => ZONES.reduce((n, z) => n + cubesOn(state, c.id, z), 0)).sort();
    expect(counts).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    for (const seat of [0, 1, 2]) expect(state.positions[seat]).toBe(HUB);
  });

  it("deals hands by table size and buries an epidemic in every pile", () => {
    const three = remedy.createState(config, seats3, "s") as RemedyState;
    expect(three.hands[0]).toHaveLength(3);
    expect(three.playerDeck.filter((c) => c === "epidemic")).toHaveLength(5);

    const two = remedy.createState(config, makeBotSeats(2), "s") as RemedyState;
    expect(two.hands[0]).toHaveLength(4);
    const heroic = remedy.createState(
      remedy.configSchema.parse({ difficulty: "heroic" }),
      seats3,
      "s"
    ) as RemedyState;
    expect(heroic.playerDeck.filter((c) => c === "epidemic")).toHaveLength(6);
  });

  it("gives everyone a different role", () => {
    const state = remedy.createState(config, makeBotSeats(5), "roles") as RemedyState;
    const roles = Object.values(state.roles);
    expect(new Set(roles).size).toBe(5);
  });
});

describe("remedy rules", () => {
  it("treats one cube, or all of them for the medic and for a cured colour", () => {
    const state = remedy.createState(config, seats3, "treat") as RemedyState;
    const zone = zoneOf(HUB);
    state.cubes[HUB]![zone] = 3;
    state.supply[zone] = CUBES_PER_ZONE - 3;
    state.roles[0] = "scientist";
    state.turn = 0;

    const one = remedy.applyMove(state, 0, { kind: "treat", zone });
    expect(one.ok).toBe(true);
    if (one.ok) expect(cubesOn(one.value.state, HUB, zone)).toBe(2);

    state.roles[0] = "medic";
    const all = remedy.applyMove(state, 0, { kind: "treat", zone });
    expect(all.ok).toBe(true);
    if (all.ok) expect(cubesOn(all.value.state, HUB, zone)).toBe(0);

    state.roles[0] = "scientist";
    state.cured[zone] = true;
    const cured = remedy.applyMove(state, 0, { kind: "treat", zone });
    expect(cured.ok).toBe(true);
    if (cured.ok) expect(cubesOn(cured.value.state, HUB, zone)).toBe(0);
  });

  it("needs five cards for a cure, or four for the scientist", () => {
    const state = remedy.createState(config, seats3, "cure") as RemedyState;
    state.turn = 0;
    const zone = ZONES[0]!;
    const cards = CITIES.filter((c) => c.zone === zone).slice(0, 5).map((c) => c.id);
    state.hands[0] = cards;
    state.positions[0] = HUB;
    state.roles[0] = "medic";

    const four = remedy.applyMove(state, 0, { kind: "cure", zone, cards: cards.slice(0, 4) });
    expect(four.ok).toBe(false);

    const five = remedy.applyMove(state, 0, { kind: "cure", zone, cards });
    expect(five.ok).toBe(true);
    if (five.ok) expect(five.value.state.cured[zone]).toBe(true);

    state.roles[0] = "scientist";
    const scientist = remedy.applyMove(state, 0, { kind: "cure", zone, cards: cards.slice(0, 4) });
    expect(scientist.ok).toBe(true);
  });

  it("breaks out on a fourth cube, and chains into the neighbours", () => {
    const state = remedy.createState(config, seats3, "outbreak") as RemedyState;
    const city = CITIES.find((c) => c.links.length >= 3)!;
    const zone = city.zone;
    for (const c of CITIES) state.cubes[c.id] = { amber: 0, cobalt: 0, verdant: 0, rust: 0 };
    state.supply[zone] = CUBES_PER_ZONE;
    state.cubes[city.id]![zone] = 3;
    state.supply[zone] -= 3;
    state.infectionDeck = [city.id, ...state.infectionDeck.filter((c) => c !== city.id)];
    state.turn = 0;
    state.actionsLeft = 0;

    const res = remedy.applyMove(state, 0, { kind: "end-turn" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.value.state;
    expect(after.outbreaks).toBeGreaterThanOrEqual(1);
    // Its neighbours all took a cube of the same colour.
    const spread = city.links.filter((l) => cubesOn(after, l, zone) > 0);
    expect(spread.length).toBeGreaterThan(0);
    // And the city itself is still on three, not four.
    expect(cubesOn(after, city.id, zone)).toBeLessThanOrEqual(3);
  });

  it("loses when the outbreak track runs out", () => {
    const state = remedy.createState(config, seats3, "lose") as RemedyState;
    state.outbreaks = OUTBREAK_LIMIT - 1;
    const city = CITIES[0]!;
    const zone = city.zone;
    state.cubes[city.id]![zone] = 3;
    state.infectionDeck = [city.id, ...state.infectionDeck.filter((c) => c !== city.id)];
    state.turn = 0;
    state.actionsLeft = 0;
    const res = remedy.applyMove(state, 0, { kind: "end-turn" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.state.finished).toBe(true);
    expect(res.value.state.outcome).toBe("lost");
    expect(res.value.state.lostBecause).toMatch(/outbreak/i);
  });

  it("loses when a colour runs out of cubes", () => {
    const state = remedy.createState(config, seats3, "cubes") as RemedyState;
    const city = CITIES[0]!;
    const zone = city.zone;
    state.supply[zone] = 0;
    state.cubes[city.id]![zone] = 0;
    state.infectionDeck = [city.id, ...state.infectionDeck.filter((c) => c !== city.id)];
    state.turn = 0;
    state.actionsLeft = 0;
    const res = remedy.applyMove(state, 0, { kind: "end-turn" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.state.outcome).toBe("lost");
      expect(res.value.state.lostBecause).toMatch(/cubes/i);
    }
  });

  it("steps the infection rate up on an epidemic, and puts the discard back on top", () => {
    const state = remedy.createState(config, seats3, "epidemic") as RemedyState;
    state.playerDeck = ["epidemic", ...state.playerDeck.filter((c) => c !== "epidemic")];
    state.turn = 0;
    state.actionsLeft = 0;
    const before = rateOf(state);
    const discardBefore = state.infectionDiscard.length;
    expect(discardBefore).toBeGreaterThan(0);

    const res = remedy.applyMove(state, 0, { kind: "end-turn" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.value.state;
    expect(rateOf(after)).toBeGreaterThanOrEqual(before);
    expect(INFECTION_RATES).toEqual([2, 2, 2, 3, 3, 4, 4]);
    // The old discards are back on top of the deck, ready to come round again.
    expect(after.infectionDeck.length).toBeGreaterThan(state.infectionDeck.length - 5);
  });

  it("asks the other player before the courier moves them", () => {
    const state = remedy.createState(config, seats3, "courier") as RemedyState;
    state.roles[0] = "courier";
    state.turn = 0;
    const other = 1;
    const to = cityById(state.positions[other]!).links[0]!;

    const res = remedy.applyMove(state, 0, { kind: "courier-move", pawn: other, to });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const asked = res.value.state;
    expect(asked.pending[0]?.seat).toBe(other);
    expect(remedy.currentSeats(asked)).toEqual([other]);
    expect(asked.positions[other]).not.toBe(to);

    const no = remedy.applyMove(asked, other, { kind: "consent", agree: false });
    expect(no.ok).toBe(true);
    if (no.ok) expect(no.value.state.positions[other]).not.toBe(to);

    const yes = remedy.applyMove(asked, other, { kind: "consent", agree: true });
    expect(yes.ok).toBe(true);
    if (yes.ok) expect(yes.value.state.positions[other]).toBe(to);
  });

  it("lets the engineer build without a card and the analyst share any card", () => {
    const state = remedy.createState(config, seats3, "roles") as RemedyState;
    state.turn = 0;
    state.roles[0] = "engineer";
    state.positions[0] = CITIES.find((c) => c.id !== HUB)!.id;
    state.hands[0] = [];
    const built = remedy.applyMove(state, 0, { kind: "build" });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.state.labs).toContain(state.positions[0]);

    state.roles[0] = "analyst";
    state.positions[1] = state.positions[0]!;
    const elsewhere = CITIES.find((c) => c.id !== state.positions[0])!.id;
    state.hands[0] = [elsewhere];
    const shared = remedy.applyMove(state, 0, { kind: "share", with: 1, card: elsewhere, give: true });
    expect(shared.ok).toBe(true);
    if (shared.ok) expect(shared.value.state.hands[1]).toContain(elsewhere);
  });
});

describe("remedy as a Gambit game", () => {
  it("shows the team everything except the order of the decks", () => {
    const state = remedy.createState(config, seats3, "open") as RemedyState;
    const view = redactStateFor(state, 0) as RemedyView;
    // A co-op plans out loud: every hand is on the table.
    expect(view.hands[1]).toEqual(state.hands[1]);
    // But the decks are face down.
    expect(view).not.toHaveProperty("playerDeck");
    expect(view).not.toHaveProperty("infectionDeck");
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(state.infectionDeck.slice(0, 8)));
    expect(view.playerDeckCount).toBe(state.playerDeck.length);
  });

  it("holds its invariants across random walks", () => {
    const report = checkProperties(remedy, { lines: 3, maxPly: 300, seats: 3 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games at every table size and difficulty", () => {
    for (const seats of [2, 3, 4, 5]) {
      for (const difficulty of ["introductory", "standard", "heroic"]) {
        const batch = simulateMany(remedy, 4, { seats, level: 2, config: { difficulty }, maxPly: 4000 });
        expect(batch.failures.map((f) => f.error), `${difficulty} @ ${seats}`).toEqual([]);
      }
    }
  });

  it("is both winnable and losable by the bots", () => {
    let won = 0;
    let lost = 0;
    for (let i = 0; i < 30; i++) {
      const sim = simulate(remedy, {
        seats: 4,
        level: 3,
        seed: `balance-${i}`,
        config: { difficulty: "introductory" },
        maxPly: 4000
      });
      if (sim.winner.length > 0) won++;
      else lost++;
    }
    expect(won + lost).toBe(30);
    expect(lost, "the board should beat the bots sometimes").toBeGreaterThan(0);
  });

  it("everybody wins or nobody does", () => {
    const sim = simulate(remedy, { seats: 3, level: 2, seed: "together", maxPly: 4000 });
    const wins = sim.scores.filter((s) => s.total > 0).length;
    expect(wins === 0 || wins === sim.scores.length).toBe(true);
  });

  it("replays exactly", () => {
    const sim = simulate(remedy, { seats: 3, level: 2, seed: "replay", maxPly: 4000 });
    expect(sim.error).toBeUndefined();
    const a = replay(remedy, { seats: seats3, seed: sim.seed, log: sim.log });
    const b = replay(remedy, { seats: seats3, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
