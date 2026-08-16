"use client";
/**
 * The production transport: Supabase Realtime down, HTTP up.
 *
 * Moves still go up as POSTs — a client may never write a move, only ask the
 * engine to — but the redacted deltas come back over a websocket instead of an
 * SSE stream held open by a serverless function.
 *
 * Each seat subscribes to its own channel, which is the only one carrying
 * hidden information, plus the room channel for chat and presence. The server
 * broadcasts to `room:<id>:seat:<n>`; a client that subscribed to somebody
 * else's channel would receive their hand, so the seat it subscribes to comes
 * from the server's own snapshot, never from anything the client chose.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ClientMessage,
  ConnectionStatus,
  GameTransport,
  ServerMessage,
  TransportHandle
} from "@gambit/core";

export interface SupabaseTransportOptions {
  url: string;
  anonKey: string;
  /** Where moves and chat are posted. Defaults to same-origin `/api`. */
  baseUrl?: string;
}

export class SupabaseTransport implements GameTransport {
  private client: SupabaseClient;
  private base: string;

  constructor(opts: SupabaseTransportOptions) {
    this.client = createClient(opts.url, opts.anonKey, {
      auth: { persistSession: true },
      realtime: { params: { eventsPerSecond: 20 } }
    });
    this.base = opts.baseUrl ?? "/api";
  }

  async connect(opts: {
    roomId: string;
    playerId: string;
    seat: number | null;
    sinceSeq: number;
    onMessage: (msg: ServerMessage) => void;
    onStatus: (status: ConnectionStatus) => void;
  }): Promise<TransportHandle> {
    opts.onStatus("connecting");
    const channels: RealtimeChannel[] = [];

    const subscribe = (name: string) => {
      const channel = this.client
        .channel(name, { config: { broadcast: { self: true } } })
        .on("broadcast", { event: "gambit" }, ({ payload }) => {
          opts.onMessage(payload as ServerMessage);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") opts.onStatus("live");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") opts.onStatus("reconnecting");
          else if (status === "CLOSED") opts.onStatus("offline");
        });
      channels.push(channel);
    };

    subscribe(`room:${opts.roomId}`);
    if (opts.seat !== null) subscribe(`room:${opts.roomId}:seat:${opts.seat}`);
    else subscribe(`room:${opts.roomId}:spectators`);

    // Realtime carries what happens next; the catch-up for what was missed
    // comes from the same snapshot endpoint the SSE transport uses, so a
    // reconnect after a tunnel or a closed laptop resumes identically.
    try {
      const res = await fetch(`${this.base}/rooms/${opts.roomId}?since=${opts.sinceSeq}`);
      if (res.ok) {
        const snap = (await res.json()) as {
          version: number;
          seq: number;
          view: unknown;
          legal: unknown[];
          current: number[];
          terminal: boolean;
          history: ServerMessage[];
          room: unknown;
        };
        opts.onMessage({ type: "hello", roomId: opts.roomId, version: snap.version, seq: snap.seq });
        if (snap.view !== null) {
          opts.onMessage({
            type: "delta",
            version: snap.version,
            seq: snap.seq,
            events: snap.history as never,
            view: snap.view,
            current: snap.current,
            legal: snap.legal,
            terminal: snap.terminal
          });
        }
      }
    } catch {
      opts.onStatus("offline");
    }

    return {
      close: () => {
        for (const channel of channels) void this.client.removeChannel(channel);
      }
    };
  }

  async send(roomId: string, msg: ClientMessage): Promise<void> {
    const path =
      msg.type === "move"
        ? `${this.base}/rooms/${roomId}/moves`
        : msg.type === "chat"
          ? `${this.base}/rooms/${roomId}/chat`
          : `${this.base}/rooms/${roomId}/presence`;

    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg),
      keepalive: msg.type !== "move"
    });

    if (!res.ok) {
      let message = "That move didn't land.";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) message = body.error.message;
      } catch {
        /* keep the default */
      }
      throw new Error(message);
    }
  }
}
