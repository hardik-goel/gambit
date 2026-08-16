/**
 * The server-side table: one authoritative loop, one event log, one broadcaster.
 *
 * In development and self-hosted same-room play this is an in-process store and
 * an SSE fan-out. In production the same `EngineDeps` is built with the Supabase
 * store and the Realtime broadcaster — see `lib/server/supabase.ts`. Route
 * handlers never know which one they got.
 */
import {
  MemoryRoomStore,
  addAnalyticsSink,
  track,
  type Broadcaster,
  type EngineDeps,
  type ServerMessage
} from "@gambit/core";
import { CATALOG } from "@gambit/games";
import type { SeatId } from "@gambit/sdk";
import { recordRatings } from "./ratings";
import { SupabaseRoomStore, hasSupabase, supabaseBroadcaster } from "./supabase";
import { rememberResult, socialPort } from "./social";

// In development the sink is the log; in production it is one call to the
// warehouse. Either way the game never waits on it.
addAnalyticsSink((event) => {
  if (process.env.NODE_ENV !== "production") console.log("[gambit]", event.name, event);
});

interface Subscriber {
  roomId: string;
  playerId: string;
  seat: SeatId | null;
  send(msg: ServerMessage): void;
}

/**
 * Next.js reloads modules on edit; a module-level singleton stashed on
 * globalThis survives that and keeps live tables alive across hot reloads.
 */
const g = globalThis as typeof globalThis & {
  __gambit?: { store: MemoryRoomStore; subs: Set<Subscriber> };
};

if (!g.__gambit) {
  g.__gambit = { store: new MemoryRoomStore(), subs: new Set() };
}

/**
 * Which store is in play.
 *
 * With Supabase configured, the production store and Realtime broadcaster take
 * over; without it, the in-process pair below runs the whole platform with
 * nothing to provision. The engine cannot tell the difference — that is the
 * point of the port.
 */
export const usingSupabase = hasSupabase();

export const store = g.__gambit.store;
const subscribers = g.__gambit.subs;

export function subscribe(sub: Subscriber): () => void {
  subscribers.add(sub);
  return () => subscribers.delete(sub);
}

/** Update a subscriber's seat after they sit down mid-session. */
export function setSubscriberSeat(playerId: string, roomId: string, seat: SeatId | null): void {
  for (const s of subscribers) {
    if (s.playerId === playerId && s.roomId === roomId) s.seat = seat;
  }
}

const broadcast: Broadcaster = {
  toSeat(roomId, seat, msg) {
    for (const s of subscribers) if (s.roomId === roomId && s.seat === seat) safeSend(s, msg);
  },
  toSpectators(roomId, msg) {
    for (const s of subscribers) if (s.roomId === roomId && s.seat === null) safeSend(s, msg);
  },
  toRoom(roomId, msg) {
    for (const s of subscribers) if (s.roomId === roomId) safeSend(s, msg);
  }
};

function safeSend(sub: Subscriber, msg: ServerMessage): void {
  try {
    sub.send(msg);
  } catch {
    // A dead stream is not an error worth failing a move over; the client will
    // reconnect and resume from its last sequence number.
    subscribers.delete(sub);
  }
}

export const deps: EngineDeps = {
  store: usingSupabase ? new SupabaseRoomStore() : store,
  catalog: CATALOG,
  broadcast: usingSupabase ? supabaseBroadcaster() : broadcast,
  social: socialPort,
  onFinish({ room, gameId, seats, scores }) {
    // Ratings and analytics hang off the finish hook rather than sitting inside
    // the pipeline, so a game that ends is never held up by either.
    recordRatings(gameId, seats, scores);
    // "Played with recently" is the list that makes adding a friend one tap.
    rememberResult(gameId, seats.map((s) => ({ playerId: s.playerId, name: s.name })));
    track({
      name: "game_finished",
      gameId,
      players: seats.filter((s) => !s.isBot).length,
      minutes: room.startedAt ? Math.round((Date.now() - room.startedAt) / 60000) : 0
    });
  }
};
