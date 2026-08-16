import { beforeEach, describe, expect, it } from "vitest";
import chess from "@gambit/game-chess";
import {
  blockedAtTable,
  defaultAvatar,
  makeFriendCode,
  normalizeFriendCode,
  recentPlayers,
  type SocialPort
} from "./social";
import { MemoryRoomStore } from "./stores/memory";
import { nullBroadcaster } from "./transport";
import { createRoom, joinRoom } from "./rooms";
import { quickMatch } from "./matchmaking";
import type { EngineDeps } from "./engine";

/** A social layer where a fixed set of pairs refuse to sit together. */
const socialWith = (pairs: [string, string][]): SocialPort => ({
  blocked: (a, b) => pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
});

let deps: EngineDeps;

beforeEach(() => {
  deps = {
    store: new MemoryRoomStore(),
    catalog: { chess },
    broadcast: nullBroadcaster
  };
});

describe("friend codes and avatars", () => {
  it("avoids the glyphs people read wrong, and normalises what they type", () => {
    for (let i = 0; i < 200; i++) {
      const code = makeFriendCode();
      expect(code).toHaveLength(6);
      expect(code).not.toMatch(/[OIS015]/);
    }
    expect(normalizeFriendCode("  ab-cd ef ")).toBe("ABCDEF");
    expect(normalizeFriendCode("abcdefghij")).toHaveLength(6);
  });

  it("gives the same player the same avatar every time", () => {
    expect(defaultAvatar("p_abc")).toBe(defaultAvatar("p_abc"));
    expect([...defaultAvatar("p_abc")]).toHaveLength(1);
  });
});

describe("recent players", () => {
  it("lists who you played with, newest first, without you or the bots", () => {
    const recent = recentPlayers(
      [
        {
          gameId: "chess",
          finishedAt: 100,
          seats: [
            { playerId: "me", name: "Me" },
            { playerId: "ada", name: "Ada" }
          ]
        },
        {
          gameId: "mosaic",
          finishedAt: 200,
          seats: [
            { playerId: "me", name: "Me" },
            { playerId: "bo", name: "Bo" },
            { playerId: "bot:1", name: "Ember" }
          ]
        }
      ],
      "me"
    );
    expect(recent.map((r) => r.playerId)).toEqual(["bo", "ada"]);
    expect(recent[0]!.gameId).toBe("mosaic");
  });

  it("mentions each person once, however often you've played them", () => {
    const results = Array.from({ length: 5 }, (_, i) => ({
      gameId: "chess",
      finishedAt: i,
      seats: [
        { playerId: "me", name: "Me" },
        { playerId: "ada", name: "Ada" }
      ]
    }));
    expect(recentPlayers(results, "me")).toHaveLength(1);
  });
});

describe("blocking", () => {
  it("names who at a table a player will not sit with", () => {
    const social = socialWith([["ada", "bo"]]);
    const table = [{ playerId: "ada" }, { playerId: "bo" }, { playerId: "cy" }];
    expect(blockedAtTable(social, "ada", table)).toEqual(["bo"]);
    expect(blockedAtTable(social, "cy", table)).toEqual([]);
    // No social layer at all means nothing is blocked.
    expect(blockedAtTable(undefined, "ada", table)).toEqual([]);
  });

  it("keeps a blocked player out of the room, without saying why", async () => {
    deps.social = socialWith([["ada", "bo"]]);
    const created = await createRoom(deps, { gameId: "chess", host: { playerId: "ada", name: "Ada" } });
    if (!created.ok) throw new Error("no room");

    const refused = await joinRoom(deps, created.value.id, { playerId: "bo", name: "Bo" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("blocked");
      // The message must not name the person or say a block exists.
      expect(refused.error.message.toLowerCase()).not.toContain("block");
      expect(refused.error.message.toLowerCase()).not.toContain("ada");
    }

    // Everybody else walks straight in.
    const welcome = await joinRoom(deps, created.value.id, { playerId: "cy", name: "Cy" });
    expect(welcome.ok).toBe(true);
  });

  it("works whichever of the two did the blocking", async () => {
    deps.social = socialWith([["bo", "ada"]]);
    const created = await createRoom(deps, { gameId: "chess", host: { playerId: "ada", name: "Ada" } });
    if (!created.ok) throw new Error("no room");
    const refused = await joinRoom(deps, created.value.id, { playerId: "bo", name: "Bo" });
    expect(refused.ok).toBe(false);
  });

  it("never seats blocked players together in quick match", async () => {
    deps.social = socialWith([["ada", "bo"]]);
    const first = await quickMatch(deps, { gameId: "chess", player: { playerId: "ada", name: "Ada" } });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Bo would normally join Ada's table; instead a second one opens.
    const second = await quickMatch(deps, { gameId: "chess", player: { playerId: "bo", name: "Bo" } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toBe(true);
    expect(second.value.room.id).not.toBe(first.value.room.id);

    // And somebody unrelated still fills the first table rather than a third.
    const third = await quickMatch(deps, { gameId: "chess", player: { playerId: "cy", name: "Cy" } });
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.value.created).toBe(false);
  });
});
