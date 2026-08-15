/**
 * In-process authoritative store.
 *
 * Backs local development, the test kit, and same-room play where one device
 * (or one Node process) is the table. It implements exactly the same contract
 * as the Supabase store, so nothing above it can tell the difference.
 */
import type { Room, RoomPlayer, Snapshot, StoredEvent, StoredMove } from "../room";
import { VersionConflictError, type AppendInput, type AppendOutput, type RoomStore } from "../store";

interface Entry {
  room: Room;
  version: number;
  state: unknown;
  updatedAt: number;
  events: StoredEvent[];
  moves: StoredMove[];
  keys: Map<string, StoredMove>;
  result?: unknown;
  /** Serializes appends so two concurrent moves can't interleave. */
  lock: Promise<void>;
}

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Entry>();
  private byCode = new Map<string, string>();
  private seq = 0;

  async createRoom(room: Room): Promise<Room> {
    this.rooms.set(room.id, {
      room,
      version: 0,
      state: null,
      updatedAt: room.createdAt,
      events: [],
      moves: [],
      keys: new Map(),
      lock: Promise.resolve()
    });
    this.byCode.set(room.code, room.id);
    return room;
  }

  async getRoom(id: string): Promise<Room | null> {
    return this.rooms.get(id)?.room ?? null;
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const id = this.byCode.get(code.toUpperCase());
    return id ? this.getRoom(id) : null;
  }

  async updateRoom(id: string, patch: Partial<Room>): Promise<Room> {
    const e = this.must(id);
    e.room = { ...e.room, ...patch };
    return e.room;
  }

  async upsertPlayer(roomId: string, player: RoomPlayer): Promise<Room> {
    const e = this.must(roomId);
    const players = e.room.players.slice();
    const i = players.findIndex((p) => p.playerId === player.playerId);
    if (i >= 0) players[i] = player;
    else players.push(player);
    e.room = { ...e.room, players };
    return e.room;
  }

  async removePlayer(roomId: string, playerId: string): Promise<Room> {
    const e = this.must(roomId);
    e.room = { ...e.room, players: e.room.players.filter((p) => p.playerId !== playerId) };
    return e.room;
  }

  async getSnapshot(roomId: string): Promise<Snapshot | null> {
    const e = this.rooms.get(roomId);
    if (!e || e.version === 0) return null;
    return { roomId, version: e.version, state: e.state, updatedAt: e.updatedAt };
  }

  async putSnapshot(snap: Snapshot): Promise<void> {
    const e = this.must(snap.roomId);
    e.version = snap.version;
    e.state = snap.state;
    e.updatedAt = snap.updatedAt;
  }

  async append(input: AppendInput): Promise<AppendOutput> {
    const e = this.must(input.roomId);
    // Serialize: each append waits for the previous one to land.
    const run = e.lock.then(async () => {
      if (e.version !== input.expectedVersion) {
        throw new VersionConflictError(input.expectedVersion, e.version);
      }
      const version = e.version + 1;
      const at = Date.now();
      const stored: StoredEvent[] = input.events.map((event) => ({
        seq: ++this.seq,
        roomId: input.roomId,
        seat: input.seat,
        event,
        version,
        at
      }));
      e.events.push(...stored);
      e.version = version;
      e.state = input.state;
      e.updatedAt = at;
      if (input.move) {
        const m: StoredMove = {
          seq: this.seq,
          seat: input.move.seat,
          move: input.move.move,
          idempotencyKey: input.move.idempotencyKey,
          at
        };
        e.moves.push(m);
        e.keys.set(m.idempotencyKey, m);
      }
      return { version, events: stored };
    });
    e.lock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async getEventsSince(roomId: string, seq: number): Promise<StoredEvent[]> {
    return this.must(roomId).events.filter((e) => e.seq > seq);
  }

  async getMoves(roomId: string): Promise<StoredMove[]> {
    return this.must(roomId).moves.slice();
  }

  async findByIdempotencyKey(roomId: string, key: string): Promise<StoredMove | null> {
    return this.rooms.get(roomId)?.keys.get(key) ?? null;
  }

  async listOpenRooms(gameId?: string): Promise<Room[]> {
    return [...this.rooms.values()]
      .map((e) => e.room)
      .filter((r) => r.status === "lobby" && (!gameId || r.gameId === gameId));
  }

  async recordResult(roomId: string, result: unknown): Promise<void> {
    this.must(roomId).result = result;
  }

  async getResult(roomId: string): Promise<unknown> {
    return this.rooms.get(roomId)?.result ?? null;
  }

  /** Housekeeping for long-lived dev servers. */
  sweep(olderThanMs: number, now = Date.now()): number {
    let removed = 0;
    for (const [id, e] of this.rooms) {
      if (now - Math.max(e.updatedAt, e.room.createdAt) > olderThanMs) {
        this.rooms.delete(id);
        this.byCode.delete(e.room.code);
        removed++;
      }
    }
    return removed;
  }

  private must(id: string): Entry {
    const e = this.rooms.get(id);
    if (!e) throw new Error(`unknown room: ${id}`);
    return e;
  }
}
