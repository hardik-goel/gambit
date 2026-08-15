"use client";
/**
 * HTTP + Server-Sent Events transport.
 *
 * Moves go up as POSTs (idempotency-keyed, so a retry after a flaky tunnel is
 * free); redacted deltas come down a single SSE stream per seat. It works
 * everywhere a browser works, needs no extra service, and carries same-room
 * play on a home network with latency nobody can feel.
 *
 * Production swaps this for the Supabase Realtime transport; Phase 2 swaps it
 * for NearbyTransport. Same interface, same client code.
 */
import type {
  ClientMessage,
  ConnectionStatus,
  GameTransport,
  ServerMessage,
  TransportHandle
} from "@gambit/core";

export interface HttpTransportOptions {
  /** Defaults to same-origin `/api`. */
  baseUrl?: string;
  /** Backoff ceiling for reconnects. */
  maxBackoffMs?: number;
}

export class HttpTransport implements GameTransport {
  private base: string;
  private maxBackoff: number;

  constructor(opts: HttpTransportOptions = {}) {
    this.base = opts.baseUrl ?? "/api";
    this.maxBackoff = opts.maxBackoffMs ?? 8000;
  }

  async connect(opts: {
    roomId: string;
    playerId: string;
    seat: number | null;
    sinceSeq: number;
    onMessage: (msg: ServerMessage) => void;
    onStatus: (status: ConnectionStatus) => void;
  }): Promise<TransportHandle> {
    let closed = false;
    let source: EventSource | null = null;
    let attempt = 0;
    let sinceSeq = opts.sinceSeq;

    const open = () => {
      if (closed) return;
      opts.onStatus(attempt === 0 ? "connecting" : "reconnecting");
      const url = new URL(`${this.base}/rooms/${opts.roomId}/stream`, location.origin);
      url.searchParams.set("playerId", opts.playerId);
      // Resume: the server replays everything we missed before going live.
      url.searchParams.set("since", String(sinceSeq));
      const es = new EventSource(url.toString());
      source = es;

      es.onopen = () => {
        attempt = 0;
        opts.onStatus("live");
      };
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMessage;
          if ("seq" in msg && typeof msg.seq === "number") sinceSeq = Math.max(sinceSeq, msg.seq);
          opts.onMessage(msg);
        } catch {
          /* a malformed frame is never worth killing the stream over */
        }
      };
      es.onerror = () => {
        es.close();
        if (closed) return;
        attempt++;
        opts.onStatus(navigator.onLine === false ? "offline" : "reconnecting");
        const wait = Math.min(this.maxBackoff, 400 * 2 ** Math.min(attempt, 5));
        setTimeout(open, wait + Math.random() * 250);
      };
    };

    open();
    return {
      close: () => {
        closed = true;
        source?.close();
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
      // Keeps the last move alive through a tab close on mobile.
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
