/**
 * The persistence port.
 *
 * Two implementations ship: an in-process memory store (local dev, same-room
 * play, tests) and a Supabase store (production). The move pipeline knows only
 * this interface, so swapping the backend — or later, moving the authoritative
 * loop onto a phone for offline same-room play — is a store + transport swap,
 * not a rewrite.
 */
import type { Room, RoomPlayer, Snapshot, StoredEvent, StoredMove } from "./room";
import type { GameEvent, SeatId } from "@gambit/sdk";

export interface AppendInput {
  roomId: string;
  seat: SeatId | null;
  events: GameEvent[];
  state: unknown;
  /** Version the writer read; the append fails if the room has moved on. */
  expectedVersion: number;
  move?: { seat: SeatId; move: unknown; idempotencyKey: string };
}

export interface AppendOutput {
  version: number;
  events: StoredEvent[];
}

export interface RoomStore {
  createRoom(room: Room): Promise<Room>;
  getRoom(id: string): Promise<Room | null>;
  getRoomByCode(code: string): Promise<Room | null>;
  updateRoom(id: string, patch: Partial<Room>): Promise<Room>;
  upsertPlayer(roomId: string, player: RoomPlayer): Promise<Room>;
  removePlayer(roomId: string, playerId: string): Promise<Room>;

  getSnapshot(roomId: string): Promise<Snapshot | null>;
  putSnapshot(snap: Snapshot): Promise<void>;

  /** Atomic: check version, append events + move, bump version, save state. */
  append(input: AppendInput): Promise<AppendOutput>;

  getEventsSince(roomId: string, seq: number): Promise<StoredEvent[]>;
  getMoves(roomId: string): Promise<StoredMove[]>;

  /** Returns the prior result if this key was already applied (retry safety). */
  findByIdempotencyKey(roomId: string, key: string): Promise<StoredMove | null>;

  listOpenRooms(gameId?: string): Promise<Room[]>;
  recordResult(roomId: string, result: unknown): Promise<void>;
}

/** Thrown when `expectedVersion` no longer matches — the caller should re-read. */
export class VersionConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`version conflict: expected ${expected}, store is at ${actual}`);
    this.name = "VersionConflictError";
  }
}
