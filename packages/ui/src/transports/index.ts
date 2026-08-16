"use client";
/**
 * Picking a transport, without shipping both.
 *
 * One long-lived Node process (development, a VM, a container) can hold an SSE
 * stream open and keep every subscriber in memory, so that is what it uses. A
 * serverless deployment can do neither, so when Supabase is configured the
 * client talks over Realtime instead.
 *
 * The Realtime client is a quarter of a megabyte, and the shelf has no use for
 * it — nor does any table on the SSE path. So it is behind a dynamic import and
 * this wrapper, which defers the choice until something actually connects. The
 * bundler puts it in its own chunk, and a deployment that never uses it never
 * downloads it.
 */
import type { ClientMessage, GameTransport, ServerMessage, TransportHandle } from "@gambit/core";
import { HttpTransport } from "./http";

export { HttpTransport } from "./http";
export type { SupabaseTransportOptions } from "./supabase";

const realtimeConfigured = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

class LazyTransport implements GameTransport {
  private real: GameTransport | null = null;

  private async resolve(): Promise<GameTransport> {
    if (this.real) return this.real;
    if (realtimeConfigured()) {
      const { SupabaseTransport } = await import("./supabase");
      this.real = new SupabaseTransport({
        url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      });
    } else {
      this.real = new HttpTransport();
    }
    return this.real;
  }

  async connect(opts: Parameters<GameTransport["connect"]>[0]): Promise<TransportHandle> {
    const transport = await this.resolve();
    return transport.connect(opts);
  }

  async send(roomId: string, msg: ClientMessage): Promise<void> {
    const transport = await this.resolve();
    return transport.send(roomId, msg);
  }
}

let cached: GameTransport | null = null;

export function chooseTransport(): GameTransport {
  if (!cached) cached = new LazyTransport();
  return cached;
}

/** Which one is in play — the connection dot says so, honestly. */
export const transportName = (): "realtime" | "stream" => (realtimeConfigured() ? "realtime" : "stream");

export type { ServerMessage };
