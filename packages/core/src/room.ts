/** Room and table types — the platform's own vocabulary, game-agnostic. */
import type { BotLevel, GameEvent, Seat, SeatId } from "@gambit/sdk";

export type RoomStatus = "lobby" | "playing" | "finished" | "abandoned";

export interface RoomPlayer {
  playerId: string;
  name: string;
  avatar?: string | null;
  seat: SeatId | null;
  team?: string;
  ready: boolean;
  isHost: boolean;
  isBot: boolean;
  botLevel?: BotLevel;
  /** Last presence heartbeat, epoch ms. */
  seenAt: number;
  connected: boolean;
}

export interface Room {
  id: string;
  /** 6-char share code, e.g. "GMB7Q4". */
  code: string;
  gameId: string;
  hostId: string;
  status: RoomStatus;
  config: Record<string, unknown>;
  players: RoomPlayer[];
  /** Server-generated seed; never exposed to clients before the game ends. */
  seed: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Seconds a seat may sit on its turn before the bot takes over. 0 = off. */
  turnTimeoutSec: number;
  /** Local table mode: everyone shares one screen; no per-seat redaction split. */
  passAndPlay: boolean;
}

/** One row of the append-only event log. */
export interface StoredEvent {
  seq: number;
  roomId: string;
  /** Which seat's move produced this event, if any. */
  seat: SeatId | null;
  event: GameEvent;
  /** State version after this event was appended. */
  version: number;
  at: number;
}

/** A stored move — the replayable record. */
export interface StoredMove {
  seq: number;
  seat: SeatId;
  move: unknown;
  idempotencyKey: string;
  at: number;
}

export interface Snapshot {
  roomId: string;
  version: number;
  /** Raw, unredacted game state. Never leaves the server. */
  state: unknown;
  updatedAt: number;
}

export function seatsFromRoom(room: Room): Seat[] {
  return room.players
    .filter((p) => p.seat !== null)
    .sort((a, b) => (a.seat as number) - (b.seat as number))
    .map((p) => ({
      id: p.seat as SeatId,
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar ?? null,
      isBot: p.isBot,
      botLevel: p.botLevel,
      team: p.team
    }));
}

export function seatOf(room: Room, playerId: string): SeatId | null {
  return room.players.find((p) => p.playerId === playerId)?.seat ?? null;
}

export function isHost(room: Room, playerId: string): boolean {
  return room.hostId === playerId;
}
