/**
 * The `RoomStore` contract, as an executable specification.
 *
 * Two implementations exist — the in-process one that runs development and
 * same-room play, and the Supabase one that runs production — and the move
 * pipeline cannot tell them apart. That promise is only worth anything if both
 * are held to the same list, so the list lives here and each implementation
 * runs it.
 *
 * The Supabase run needs a project; without one it is skipped rather than
 * quietly passing. See `apps/web/lib/server/supabase.test.ts`.
 */
import { expect } from "vitest";
import { makeSeed } from "@gambit/sdk";
import type { Room, RoomPlayer } from "../room";
import type { RoomStore } from "../store";
import { VersionConflictError } from "../store";

export interface ContractCase {
  name: string;
  run(store: RoomStore): Promise<void>;
}

let counter = 0;
function sampleRoom(): Room {
  counter++;
  const at = Date.now();
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    code: `T${String(counter).padStart(5, "0")}`.toUpperCase().slice(0, 6),
    gameId: "chess",
    hostId: "host",
    status: "lobby",
    config: { clock: "none" },
    seed: makeSeed(),
    createdAt: at,
    turnTimeoutSec: 90,
    passAndPlay: false,
    players: [
      {
        playerId: "host",
        name: "Host",
        avatar: null,
        seat: 0,
        ready: false,
        isHost: true,
        isBot: false,
        seenAt: at,
        connected: true
      }
    ]
  };
}

const guest = (id: string, seat: number | null): RoomPlayer => ({
  playerId: id,
  name: id,
  avatar: null,
  seat,
  ready: false,
  isHost: false,
  isBot: false,
  seenAt: Date.now(),
  connected: true
});

/**
 * Every behaviour the move pipeline relies on. A store that passes these can be
 * dropped in without reading the pipeline.
 */
export const STORE_CONTRACT: ContractCase[] = [
  {
    name: "round-trips a room, by id and by code",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      const byId = await store.getRoom(room.id);
      const byCode = await store.getRoomByCode(room.code);
      expect(byId?.id).toBe(room.id);
      expect(byCode?.id).toBe(room.id);
      expect(byId?.gameId).toBe("chess");
      expect(byId?.players).toHaveLength(1);
      expect(await store.getRoom("nope")).toBeNull();
    }
  },
  {
    name: "patches a room without disturbing what it wasn't asked about",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      const updated = await store.updateRoom(room.id, { status: "playing", startedAt: 1234 });
      expect(updated.status).toBe("playing");
      expect(updated.seed).toBe(room.seed);
      expect(updated.code).toBe(room.code);
      expect(updated.players).toHaveLength(1);
    }
  },
  {
    name: "seats, re-seats and removes players",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      await store.upsertPlayer(room.id, guest("bo", 1));
      let current = await store.getRoom(room.id);
      expect(current?.players).toHaveLength(2);

      await store.upsertPlayer(room.id, { ...guest("bo", 1), ready: true });
      current = await store.getRoom(room.id);
      expect(current?.players).toHaveLength(2);
      expect(current?.players.find((p) => p.playerId === "bo")?.ready).toBe(true);

      await store.removePlayer(room.id, "bo");
      current = await store.getRoom(room.id);
      expect(current?.players.map((p) => p.playerId)).toEqual(["host"]);
    }
  },
  {
    name: "has no snapshot until the first append",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      expect(await store.getSnapshot(room.id)).toBeNull();
    }
  },
  {
    name: "append writes the version, the state and the events together",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      const result = await store.append({
        roomId: room.id,
        seat: 0,
        events: [{ type: "move", text: "e4" }],
        state: { ply: 1 },
        expectedVersion: 0,
        move: { seat: 0, move: { kind: "move" }, idempotencyKey: "k1" }
      });
      expect(result.version).toBe(1);
      expect(result.events).toHaveLength(1);

      const snap = await store.getSnapshot(room.id);
      expect(snap?.version).toBe(1);
      expect((snap?.state as { ply: number }).ply).toBe(1);
    }
  },
  {
    name: "append refuses a stale version and leaves the state alone",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      await store.append({
        roomId: room.id,
        seat: 0,
        events: [{ type: "a" }],
        state: { ply: 1 },
        expectedVersion: 0
      });

      let refused = false;
      try {
        await store.append({
          roomId: room.id,
          seat: 0,
          events: [{ type: "b" }],
          state: { ply: 99 },
          expectedVersion: 0
        });
      } catch (e) {
        refused = e instanceof VersionConflictError;
      }
      expect(refused, "a stale append must throw VersionConflictError").toBe(true);

      const snap = await store.getSnapshot(room.id);
      expect((snap?.state as { ply: number }).ply).toBe(1);
      expect(snap?.version).toBe(1);
    }
  },
  {
    name: "events come back in order, and only the ones after a sequence",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      const first = await store.append({
        roomId: room.id,
        seat: 0,
        events: [{ type: "one" }],
        state: { ply: 1 },
        expectedVersion: 0
      });
      await store.append({
        roomId: room.id,
        seat: 1,
        events: [{ type: "two" }, { type: "three" }],
        state: { ply: 2 },
        expectedVersion: 1
      });

      const all = await store.getEventsSince(room.id, 0);
      expect(all.map((e) => e.event.type)).toEqual(["one", "two", "three"]);
      expect(all.map((e) => e.seq)).toEqual([...all.map((e) => e.seq)].sort((a, b) => a - b));

      const after = await store.getEventsSince(room.id, first.events.at(-1)!.seq);
      expect(after.map((e) => e.event.type)).toEqual(["two", "three"]);
    }
  },
  {
    name: "finds a move by its idempotency key, and only in its own room",
    async run(store) {
      const room = sampleRoom();
      const other = sampleRoom();
      await store.createRoom(room);
      await store.createRoom(other);
      await store.append({
        roomId: room.id,
        seat: 0,
        events: [{ type: "move" }],
        state: { ply: 1 },
        expectedVersion: 0,
        move: { seat: 0, move: { kind: "move", from: 52 }, idempotencyKey: "same-key" }
      });

      const found = await store.findByIdempotencyKey(room.id, "same-key");
      expect(found?.seat).toBe(0);
      expect(await store.findByIdempotencyKey(room.id, "different")).toBeNull();
      expect(await store.findByIdempotencyKey(other.id, "same-key")).toBeNull();
    }
  },
  {
    name: "keeps the move log for the replay",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      for (let i = 0; i < 3; i++) {
        await store.append({
          roomId: room.id,
          seat: i % 2,
          events: [{ type: "move" }],
          state: { ply: i + 1 },
          expectedVersion: i,
          move: { seat: i % 2, move: { kind: "move", n: i }, idempotencyKey: `k${i}` }
        });
      }
      const moves = await store.getMoves(room.id);
      expect(moves).toHaveLength(3);
      expect(moves.map((m) => (m.move as { n: number }).n)).toEqual([0, 1, 2]);
    }
  },
  {
    name: "lists open lobbies, and stops listing a game once it starts",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      const open = await store.listOpenRooms("chess");
      expect(open.some((r) => r.id === room.id)).toBe(true);

      await store.updateRoom(room.id, { status: "playing" });
      const after = await store.listOpenRooms("chess");
      expect(after.some((r) => r.id === room.id)).toBe(false);
    }
  },
  {
    name: "records a finished game's result",
    async run(store) {
      const room = sampleRoom();
      await store.createRoom(room);
      await store.recordResult(room.id, {
        gameId: "chess",
        seed: room.seed,
        scores: [{ seat: 0, total: 1 }],
        seats: [{ id: 0, playerId: "host", name: "Host", isBot: false }],
        finishedAt: Date.now()
      });
      // Nothing to assert beyond "it did not throw": reading results back is the
      // replay endpoint's job, not the pipeline's.
      expect(true).toBe(true);
    }
  }
];
