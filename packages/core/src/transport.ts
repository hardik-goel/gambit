/**
 * The transport port.
 *
 * v1 ships two implementations: SSE over Next.js route handlers (local dev and
 * self-hosted same-room play) and Supabase Realtime broadcast (production).
 * Phase 2's `NearbyTransport` (Capacitor + Nearby Connections / Multipeer) is a
 * third implementation of this same interface — see ROADMAP.md. Nothing above
 * this line knows which one it is talking to.
 */
import type { GameEvent, SeatId } from "@gambit/sdk";
import type { Room } from "./room";

/** Server → client. Payloads are already redacted for the recipient. */
export type ServerMessage =
  | { type: "hello"; roomId: string; version: number; seq: number }
  | {
      type: "delta";
      version: number;
      seq: number;
      /** Events this recipient is allowed to see. */
      events: GameEvent[];
      /** Redacted view after the events. */
      view: unknown;
      /** Seats that may act now — drives turn glow and timers. */
      current: SeatId[];
      /** Legal moves for the recipient's own seat. */
      legal: unknown[];
      terminal: boolean;
    }
  | { type: "room"; room: Room }
  | { type: "chat"; playerId: string; name: string; text: string; at: number; emote?: string }
  | { type: "presence"; playerId: string; connected: boolean; at: number }
  | { type: "finished"; scores: unknown }
  | { type: "error"; code: string; message: string }
  | { type: "ping"; at: number };

/** Client → server, for transports that carry an upstream channel. */
export type ClientMessage =
  | { type: "move"; move: unknown; idempotencyKey: string; clientVersion: number }
  | { type: "resume"; sinceSeq: number }
  | { type: "heartbeat" }
  | { type: "chat"; text: string; emote?: string };

export interface Broadcaster {
  /** Private per-seat channel — the only channel carrying hidden information. */
  toSeat(roomId: string, seat: SeatId, msg: ServerMessage): Promise<void> | void;
  /** Spectator channel, redacted as "spectator". */
  toSpectators(roomId: string, msg: ServerMessage): Promise<void> | void;
  /** Lobby / presence / chat — never carries game secrets. */
  toRoom(roomId: string, msg: ServerMessage): Promise<void> | void;
}

export const nullBroadcaster: Broadcaster = {
  toSeat() {},
  toSpectators() {},
  toRoom() {}
};

/** Client-side transport handle. */
export interface GameTransport {
  connect(opts: {
    roomId: string;
    playerId: string;
    seat: SeatId | null;
    sinceSeq: number;
    onMessage: (msg: ServerMessage) => void;
    onStatus: (status: ConnectionStatus) => void;
  }): Promise<TransportHandle>;
  /** Submit a move upstream. Resolves when the server has acknowledged. */
  send(roomId: string, msg: ClientMessage): Promise<void>;
}

export interface TransportHandle {
  close(): void;
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";
