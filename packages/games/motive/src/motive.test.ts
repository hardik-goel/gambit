import { describe, expect, it } from "vitest";
import { checkProperties, makeBotSeats, replay, simulate, simulateMany } from "@gambit/sdk/testkit";
import motive from "./index";
import {
  CARDS,
  DOORS,
  IMPLEMENTS,
  ROOMS,
  SECRET_PASSAGES,
  SUSPECTS,
  implementCard,
  isCorridor,
  reachable,
  roomAt,
  roomCard,
  suspectCard
} from "./mansion";
import { redactStateFor, type MotiveState, type MotiveView } from "./state";

const config = motive.configSchema.parse({});
const seats3 = makeBotSeats(3);

describe("the mansion", () => {
  it("has nine rooms, corridors between them, and doors into each", () => {
    const rooms = new Set<number>();
    for (let x = 0; x < 11; x++) {
      for (let y = 0; y < 11; y++) {
        const room = roomAt(x, y);
        if (room !== null) rooms.add(room);
      }
    }
    expect(rooms.size).toBe(9);
    for (let room = 0; room < 9; room++) {
      expect(DOORS.filter((d) => d.room === room).length, `room ${room} has no door`).toBeGreaterThan(0);
    }
    expect(isCorridor(3, 5)).toBe(true);
    expect(isCorridor(1, 1)).toBe(false);
  });

  it("joins opposite corners with secret passages", () => {
    expect(SECRET_PASSAGES[0]).toBe(8);
    expect(SECRET_PASSAGES[8]).toBe(0);
    expect(SECRET_PASSAGES[2]).toBe(6);
    expect(SECRET_PASSAGES[6]).toBe(2);
    expect(SECRET_PASSAGES[4]).toBeUndefined();
  });

  it("counts a move in corridor squares and stops on entering a room", () => {
    const door = DOORS[0]!;
    const from = { kind: "cell" as const, x: door.x, y: door.y };
    const one = reachable(from, 1, []);
    expect(one.some((p) => p.kind === "room" && p.room === door.room)).toBe(true);
    // A single step can also go one square along the corridor.
    expect(one.some((p) => p.kind === "cell")).toBe(true);

    const far = reachable(from, 6, []);
    expect(far.length).toBeGreaterThan(one.length);
  });

  it("won't walk through another pawn", () => {
    const from = { kind: "cell" as const, x: 3, y: 0 };
    const open = reachable(from, 3, []);
    const blocked = reachable(from, 3, [{ x: 3, y: 1 }]);
    expect(blocked.length).toBeLessThan(open.length);
  });

  it("carries twenty-one cards", () => {
    expect(CARDS).toHaveLength(21);
    expect(SUSPECTS).toHaveLength(6);
    expect(IMPLEMENTS).toHaveLength(6);
    expect(ROOMS).toHaveLength(9);
  });
});

describe("motive rules", () => {
  it("seals one of each away and deals the rest out evenly", () => {
    const state = motive.createState(config, seats3, "s") as MotiveState;
    const dealt = Object.values(state.hands).flat();
    expect(dealt).toHaveLength(18);
    expect(state.leftovers).toHaveLength(0);
    expect(dealt).not.toContain(suspectCard(state.caseFile.suspect));
    expect(dealt).not.toContain(implementCard(state.caseFile.implement));
    expect(dealt).not.toContain(roomCard(state.caseFile.room));

    const four = motive.createState(config, makeBotSeats(4), "s") as MotiveState;
    expect(Object.values(four.hands).flat()).toHaveLength(16);
    expect(four.leftovers).toHaveLength(2);
  });

  it("asks clockwise and stops at the first player who can answer", () => {
    const state = motive.createState(config, makeBotSeats(4), "ask") as MotiveState;
    // Put a known card in seat 2's hand and nothing relevant in seat 1's.
    const suspect = 0;
    const implement = 0;
    const room = 4;
    state.pawns[0] = { kind: "room", room };
    state.moved = true;
    state.turn = 0;
    state.hands[1] = state.hands[1]!.filter(
      (c) => ![suspectCard(suspect), implementCard(implement), roomCard(room)].includes(c)
    );
    state.hands[2] = [suspectCard(suspect), ...state.hands[2]!.slice(1)];

    const res = motive.applyMove(state, 0, { kind: "suggest", suspect, implement });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.value.state;
    // Seat 1 passed publicly; seat 2 is being asked.
    expect(res.value.events.some((e) => e.type === "pass" && e.seat === 1)).toBe(true);
    expect(after.pending[0]?.seat).toBe(2);
    expect(motive.currentSeats(after)).toEqual([2]);
    expect(motive.legalMoves(after, 0)).toEqual([]);

    const show = motive.applyMove(after, 2, { kind: "show", card: suspectCard(suspect) });
    expect(show.ok).toBe(true);
    if (!show.ok) return;
    // The table hears that a card was shown; only the asker hears which.
    const publicEvent = show.value.events.find((e) => e.type === "disproved")!;
    const privateEvent = show.value.events.find((e) => e.type === "disproved-private")!;
    expect(publicEvent.visibleTo).toBeUndefined();
    expect(JSON.stringify(publicEvent)).not.toContain(SUSPECTS[suspect]!);
    expect(privateEvent.visibleTo).toEqual([0, 2]);
    expect(show.value.state.seen[0]).toEqual([{ card: suspectCard(suspect), from: 2 }]);
  });

  it("says so out loud when nobody can disprove a suggestion", () => {
    const state = motive.createState(config, seats3, "nobody") as MotiveState;
    // Name the case file itself: by definition nobody holds any of it.
    state.pawns[0] = { kind: "room", room: state.caseFile.room };
    state.moved = true;
    state.turn = 0;
    const res = motive.applyMove(state, 0, {
      kind: "suggest",
      suspect: state.caseFile.suspect,
      implement: state.caseFile.implement
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.events.some((e) => e.type === "unchallenged")).toBe(true);
    expect(res.value.state.history.at(-1)?.shownBy).toBeNull();
    expect(res.value.state.pending).toHaveLength(0);
  });

  it("drags the named suspect — and their player — into the room", () => {
    const state = motive.createState(config, seats3, "drag") as MotiveState;
    const room = 4;
    state.pawns[0] = { kind: "room", room };
    state.moved = true;
    state.turn = 0;
    const victim = 1;
    const suspect = state.seatSuspect[victim]!;

    const res = motive.applyMove(state, 0, { kind: "suggest", suspect, implement: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const after = res.value.state;
    expect(after.pawns[victim]).toEqual({ kind: "room", room });
    expect(after.summoned).toContain(victim);
    // And on their turn they may suggest from there without moving.
    // (Clear whatever question is still going round the table first.)
    after.pending = [];
    after.suggestion = null;
    after.turn = victim;
    after.moved = false;
    after.suggested = false;
    expect(motive.legalMoves(after, victim).some((m) => m.kind === "stay")).toBe(true);
  });

  it("wins on a correct accusation and eliminates on a wrong one", () => {
    const state = motive.createState(config, seats3, "accuse") as MotiveState;
    state.moved = true;
    const right = motive.applyMove(state, 0, { kind: "accuse", ...state.caseFile });
    expect(right.ok).toBe(true);
    if (right.ok) {
      expect(right.value.state.finished).toBe(true);
      expect(right.value.state.winner).toBe(0);
    }

    const wrongRoom = (state.caseFile.room + 1) % ROOMS.length;
    const wrong = motive.applyMove(state, 0, { ...state.caseFile, kind: "accuse", room: wrongRoom });
    expect(wrong.ok).toBe(true);
    if (!wrong.ok) return;
    const after = wrong.value.state;
    expect(after.eliminated).toContain(0);
    expect(after.finished).toBe(false);
    // Out of the game, but still answering questions.
    expect(after.turn).not.toBe(0);
    expect(motive.legalMoves(after, 0)).toEqual([]);
  });
});

describe("motive keeps its secrets", () => {
  it("never sends the case file or another player's hand to a client", () => {
    const state = motive.createState(config, makeBotSeats(4), "leak") as MotiveState;
    for (const viewer of [0, 1, 2, 3, "spectator" as const]) {
      const view = redactStateFor(state, viewer) as MotiveView;
      const json = JSON.stringify(view);
      expect(view.caseFile).toBeNull();
      expect(view).not.toHaveProperty("hands");
      expect(view).not.toHaveProperty("caseFile.suspect");
      for (const seat of [0, 1, 2, 3]) {
        if (seat === viewer) continue;
        expect(json).not.toContain(JSON.stringify(state.hands[seat]));
      }
      if (viewer !== "spectator") {
        expect(view.hand).toEqual(state.hands[viewer]);
        // The notepad's automatic marks contain only what this seat can prove.
        for (const card of view.cleared) {
          const provable =
            state.hands[viewer]!.includes(card) ||
            state.leftovers.includes(card) ||
            (state.seen[viewer] ?? []).some((s) => s.card === card);
          expect(provable, `${card} was cleared without proof`).toBe(true);
        }
      }
    }
  });

  it("opens the file once the game is over", () => {
    const state = motive.createState(config, seats3, "end") as MotiveState;
    state.finished = true;
    const view = redactStateFor(state, 1) as MotiveView;
    expect(view.caseFile).toEqual(state.caseFile);
  });
});

describe("motive as a Gambit game", () => {
  it("holds its invariants across random walks", () => {
    const report = checkProperties(motive, { lines: 3, maxPly: 300, seats: 4 });
    expect(report.violations).toEqual([]);
  });

  it("finishes bot games at every table size", () => {
    for (const seats of [3, 4, 6]) {
      const batch = simulateMany(motive, 8, { seats, level: 2, maxPly: 4000 });
      expect(batch.failures.map((f) => f.error), `${seats} seats`).toEqual([]);
    }
  });

  it("is solved by the bots more often than not", () => {
    let solved = 0;
    for (let i = 0; i < 12; i++) {
      const sim = simulate(motive, { seats: 4, level: 3, seed: `solve-${i}` });
      if (sim.winner.length === 1) solved++;
    }
    expect(solved).toBeGreaterThan(0);
  });

  it("replays exactly, dice and all", () => {
    const sim = simulate(motive, { seats: 4, level: 2, seed: "replay" });
    expect(sim.error).toBeUndefined();
    const seats = makeBotSeats(4);
    const a = replay(motive, { seats, seed: sim.seed, log: sim.log });
    const b = replay(motive, { seats, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
