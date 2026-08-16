"use client";
/** React binding for the optimistic table client. */
import { TableClient, type TableState } from "@gambit/core";
import type { AnyGameDefinition, SeatId } from "@gambit/sdk";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { chooseTransport } from "./transports/index";

export interface UseTableOptions {
  def: AnyGameDefinition;
  roomId: string;
  playerId: string;
  seat: SeatId | null;
  initial?: Partial<TableState>;
}

export interface UseTableResult {
  state: TableState;
  play(move: unknown): void;
  chat(text: string, emote?: string): void;
  client: TableClient;
}

export function useTable(opts: UseTableOptions): UseTableResult {
  // SSE where a process stays alive, Supabase Realtime where it doesn't.
  const transport = useMemo(() => chooseTransport(), []);
  const clientRef = useRef<TableClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new TableClient({
      def: opts.def,
      transport,
      roomId: opts.roomId,
      playerId: opts.playerId,
      seat: opts.seat,
      initial: opts.initial
    });
  }
  const client = clientRef.current;

  useEffect(() => {
    void client.connect();
    const beat = setInterval(() => void client.send({ type: "heartbeat" }).catch(() => undefined), 15_000);
    return () => {
      clearInterval(beat);
      client.disconnect();
    };
  }, [client]);

  const state = useSyncExternalStore(
    (cb) => client.subscribe(() => cb()),
    () => client.state,
    () => client.state
  );

  return useMemo(
    () => ({
      state,
      play: (m: unknown) => client.play(m),
      chat: (t: string, e?: string) => client.chat(t, e),
      client
    }),
    [state, client]
  );
}
