/**
 * The turn clock, for a deployment with no long-lived process.
 *
 * A container sweeps live tables on a `setInterval` (`timeouts.ts`). Serverless
 * has no such thing, and Vercel's Hobby plan allows a cron once a day, which is
 * not a turn clock. So the clock is driven from two directions and decided in
 * exactly one:
 *
 *   * anyone sitting at a table nudges `/api/rooms/[id]/sweep` while they wait;
 *   * the daily cron sweeps everything, as a backstop for a table nobody is
 *     watching.
 *
 * Both call `sweepRoom`, which reads the clock from the snapshot's own age on
 * the server. A client can ask for a sweep as often as it likes and cannot
 * bring one forward by a second — which is the only property that matters,
 * because the caller is another player who benefits from the seat being taken.
 */
import { takeOverIdleSeat } from "@gambit/core";
import { deps, store } from "./table";

export interface SweepResult {
  /** True when a bot played a move for a seat that had run out of time. */
  covered: boolean;
  /** Seconds until this seat runs out, for a caller deciding when to ask again. */
  remaining: number | null;
}

export async function sweepRoom(roomId: string, now = Date.now()): Promise<SweepResult> {
  const room = await store.getRoom(roomId);
  if (!room || room.status !== "playing" || room.turnTimeoutSec <= 0) {
    return { covered: false, remaining: null };
  }

  const def = deps.catalog[room.gameId];
  const snap = await store.getSnapshot(room.id);
  if (!def || !snap) return { covered: false, remaining: null };

  const seat = def.currentSeats(snap.state)[0];
  if (seat === undefined) return { covered: false, remaining: null };

  const holder = room.players.find((p) => p.seat === seat);
  if (!holder || holder.isBot) return { covered: false, remaining: null };

  // Without a per-turn timestamp the best signal available is the snapshot's
  // own age: nothing has been written to this table since then.
  const idleFor = (now - snap.updatedAt) / 1000;
  if (idleFor < room.turnTimeoutSec) {
    return { covered: false, remaining: Math.ceil(room.turnTimeoutSec - idleFor) };
  }

  const res = await takeOverIdleSeat(deps, room.id, seat);
  if (!res.ok) return { covered: false, remaining: 0 };

  deps.broadcast.toRoom(room.id, {
    type: "chat",
    playerId: "table",
    name: "The table",
    text: `${holder.name} timed out — a bot played for them. They can take the seat back at any time.`,
    at: now
  });
  return { covered: true, remaining: room.turnTimeoutSec };
}

/**
 * Tables nobody ever sat at.
 *
 * A lobby is created the moment somebody presses a game on the shelf, and it
 * outlives them: close the tab before anyone joins and the room stays open for
 * ever, offering a table that no longer exists to everybody who comes after.
 *
 * An hour of nobody being there is enough to say so. They are marked abandoned
 * rather than deleted — a finished or abandoned room is still a record, and
 * still something that can be reported — which is all it takes to get them off
 * the shelf.
 */
export async function sweepStaleLobbies(now = Date.now()): Promise<number> {
  const AN_HOUR = 60 * 60 * 1000;
  let closed = 0;

  for (const room of await store.listOpenRooms()) {
    const lastSeen = Math.max(room.createdAt, ...room.players.map((p) => p.seenAt));
    if (now - lastSeen < AN_HOUR) continue;
    await store.updateRoom(room.id, { status: "abandoned" });
    closed++;
  }
  return closed;
}
