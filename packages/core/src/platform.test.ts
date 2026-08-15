import { describe, expect, it } from "vitest";
import chess from "@gambit/game-chess";
import { MemoryRoomStore } from "./stores/memory";
import { lobbyCounts, quickMatch } from "./matchmaking";
import { NEW_RATING, applyResult, decay, displayRating, isProvisional, updateRating } from "./ratings";
import { Percentiles, addAnalyticsSink, track } from "./analytics";
import { isValidCode, makeRoomCode, normalizeCode } from "./codes";
import { createRoom, joinRoom, setReady, takeSeat } from "./rooms";
import { startGame, type EngineDeps } from "./engine";
import { nullBroadcaster } from "./transport";

const freshDeps = (): EngineDeps => ({
  store: new MemoryRoomStore(),
  catalog: { chess },
  broadcast: nullBroadcaster
});

describe("quick match", () => {
  it("opens a table when there isn't one, and fills it when there is", async () => {
    const deps = freshDeps();
    const first = await quickMatch(deps, { gameId: "chess", player: { playerId: "a", name: "Ada" } });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toBe(true);
    expect(first.value.waitingFor).toBe(1);

    const second = await quickMatch(deps, { gameId: "chess", player: { playerId: "b", name: "Bo" } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toBe(false);
    expect(second.value.room.id).toBe(first.value.room.id);
    expect(second.value.waitingFor).toBe(0);
  });

  it("never puts a stranger at a same-room table", async () => {
    const deps = freshDeps();
    await createRoom(deps, {
      gameId: "chess",
      host: { playerId: "host", name: "Host" },
      passAndPlay: true
    });
    const res = await quickMatch(deps, { gameId: "chess", player: { playerId: "x", name: "X" } });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.created).toBe(true);
  });

  it("counts who is waiting, per game", async () => {
    const deps = freshDeps();
    await quickMatch(deps, { gameId: "chess", player: { playerId: "a", name: "Ada" } });
    expect(await lobbyCounts(deps)).toEqual({ chess: 1 });
  });

  it("stops offering a table once the game has started", async () => {
    const deps = freshDeps();
    const opened = await quickMatch(deps, { gameId: "chess", player: { playerId: "a", name: "Ada" } });
    if (!opened.ok) throw new Error("no table");
    const roomId = opened.value.room.id;
    await joinRoom(deps, roomId, { playerId: "b", name: "Bo" });
    await takeSeat(deps, roomId, "b", 1);
    await setReady(deps, roomId, "a", true);
    await setReady(deps, roomId, "b", true);
    await startGame(deps, roomId, "a");

    const late = await quickMatch(deps, { gameId: "chess", player: { playerId: "c", name: "Cy" } });
    expect(late.ok).toBe(true);
    if (late.ok) expect(late.value.room.id).not.toBe(roomId);
  });
});

describe("ratings", () => {
  it("moves an unrated player further than a settled one", () => {
    const newcomer = updateRating({ ...NEW_RATING }, [{ opponent: { ...NEW_RATING }, score: 1 }]);
    const veteran = updateRating(
      { rating: 1500, deviation: 60, games: 200 },
      [{ opponent: { ...NEW_RATING }, score: 1 }]
    );
    expect(newcomer.rating).toBeGreaterThan(1500);
    expect(veteran.rating).toBeGreaterThan(1500);
    expect(newcomer.rating - 1500).toBeGreaterThan(veteran.rating - 1500);
    expect(newcomer.deviation).toBeLessThan(NEW_RATING.deviation);
  });

  it("beating a stronger player is worth more than beating a weaker one", () => {
    const overStrong = updateRating({ ...NEW_RATING }, [
      { opponent: { rating: 1900, deviation: 60, games: 50 }, score: 1 }
    ]);
    const overWeak = updateRating({ ...NEW_RATING }, [
      { opponent: { rating: 1100, deviation: 60, games: 50 }, score: 1 }
    ]);
    expect(overStrong.rating).toBeGreaterThan(overWeak.rating);
  });

  it("scores a multiplayer table as a round robin", () => {
    const scores = [
      { seat: 0, total: 30, lines: [], rank: 1, won: true },
      { seat: 1, total: 20, lines: [], rank: 2, won: false },
      { seat: 2, total: 20, lines: [], rank: 2, won: false }
    ];
    const after = applyResult({}, scores);
    expect(after[0]!.rating).toBeGreaterThan(after[1]!.rating);
    // Two players who tied come out level with each other.
    expect(after[1]!.rating).toBeCloseTo(after[2]!.rating, 5);
    expect(after[0]!.games).toBe(2);
  });

  it("is provisional until five games, and widens while you're away", () => {
    expect(isProvisional({ ...NEW_RATING })).toBe(true);
    expect(isProvisional({ rating: 1600, deviation: 80, games: 12 })).toBe(false);
    const idle = decay({ rating: 1600, deviation: 60, games: 30 }, 90);
    expect(idle.deviation).toBeGreaterThan(60);
    expect(displayRating({ rating: 1600, deviation: 100, games: 9 })).toBe(1550);
  });
});

describe("room codes", () => {
  it("avoids the glyphs people read wrong", () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).toHaveLength(6);
      expect(isValidCode(code)).toBe(true);
      expect(code).not.toMatch(/[OIS015]/);
    }
    expect(normalizeCode("gmb-7q4x")).toBe("GMB7Q4");
    expect(normalizeCode("0O")).toBe("QQ");
  });
});

describe("analytics", () => {
  it("delivers events to every sink and survives a sink that throws", () => {
    const seen: string[] = [];
    const offBad = addAnalyticsSink(() => {
      throw new Error("the warehouse is on fire");
    });
    const offGood = addAnalyticsSink((e) => seen.push(e.name));
    track({ name: "room_created", gameId: "chess", mode: "online" });
    expect(seen).toEqual(["room_created"]);
    offBad();
    offGood();
  });

  it("reads percentiles off a rolling window", () => {
    const p = new Percentiles(100);
    for (let i = 1; i <= 100; i++) p.add(i);
    expect(p.count).toBe(100);
    expect(p.at(50)).toBeGreaterThanOrEqual(50);
    expect(p.at(95)).toBeGreaterThanOrEqual(95);
  });
});
