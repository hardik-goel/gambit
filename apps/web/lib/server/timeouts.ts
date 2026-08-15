/**
 * Turn timeouts.
 *
 * A table must never be held up by somebody who closed their laptop. Every few
 * seconds this sweeps the live rooms: a seat that has sat on its turn past the
 * table's clock gets a warning, and then a bot plays one move for it. The human
 * reclaims the seat simply by moving again — nothing is taken away, and nothing
 * is announced twice.
 *
 * This runs on the long-lived Node server (development, self-hosted same-room
 * play). On a serverless deployment the same `takeOverIdleSeat` call belongs on
 * a scheduled function; the logic is identical and lives in `@gambit/core`.
 */
import { takeOverIdleSeat, type Room } from "@gambit/core";
import type { SeatId } from "@gambit/sdk";
import { deps, store } from "./table";

const SWEEP_MS = 4_000;
/** Warn at three-quarters of the clock, act at the end of it. */
const WARN_AT = 0.75;

interface Watch {
  /** When the seat that is currently to move became the seat to move. */
  since: number;
  seat: SeatId;
  warned: boolean;
}

const g = globalThis as typeof globalThis & {
  __gambitTimeouts?: { watches: Map<string, Watch>; timer: NodeJS.Timeout | null };
};
if (!g.__gambitTimeouts) g.__gambitTimeouts = { watches: new Map(), timer: null };
const { watches } = g.__gambitTimeouts;

async function sweep(): Promise<void> {
  let rooms: Room[] = [];
  try {
    rooms = (await store.listOpenRooms()).concat();
  } catch {
    return;
  }
  // listOpenRooms only returns lobbies; the playing ones are tracked by watch().
  for (const room of rooms) watches.delete(room.id);
}

/**
 * Called by the move pipeline's HTTP face after anything happens at a table.
 * Cheaper and more accurate than polling every room in the world.
 */
export async function watchTable(roomId: string): Promise<void> {
  const room = await store.getRoom(roomId);
  if (!room || room.status !== "playing" || room.turnTimeoutSec <= 0) {
    watches.delete(roomId);
    return;
  }

  const def = deps.catalog[room.gameId];
  const snap = await store.getSnapshot(roomId);
  if (!def || !snap) return;
  const current = def.currentSeats(snap.state);
  const seat = current[0];
  if (seat === undefined) {
    watches.delete(roomId);
    return;
  }

  const existing = watches.get(roomId);
  if (!existing || existing.seat !== seat) {
    watches.set(roomId, { since: Date.now(), seat, warned: false });
  }
  ensureTimer();
}

function ensureTimer(): void {
  if (g.__gambitTimeouts!.timer) return;
  g.__gambitTimeouts!.timer = setInterval(() => {
    void tick();
  }, SWEEP_MS);
  // Never hold the process open for this.
  g.__gambitTimeouts!.timer.unref?.();
}

async function tick(): Promise<void> {
  if (watches.size === 0) {
    clearInterval(g.__gambitTimeouts!.timer!);
    g.__gambitTimeouts!.timer = null;
    return;
  }

  for (const [roomId, watch] of [...watches]) {
    const room = await store.getRoom(roomId);
    if (!room || room.status !== "playing") {
      watches.delete(roomId);
      continue;
    }

    const holder = room.players.find((p) => p.seat === watch.seat);
    // A bot's own seat is never on the clock.
    if (holder?.isBot) {
      watches.delete(roomId);
      continue;
    }

    const elapsed = (Date.now() - watch.since) / 1000;
    const limit = room.turnTimeoutSec;

    if (!watch.warned && elapsed > limit * WARN_AT) {
      watch.warned = true;
      deps.broadcast.toRoom(roomId, {
        type: "chat",
        playerId: "table",
        name: "The table",
        text: `${holder?.name ?? "Someone"} has ${Math.round(limit - elapsed)}s to move.`,
        at: Date.now()
      });
      continue;
    }

    if (elapsed > limit) {
      watches.delete(roomId);
      const res = await takeOverIdleSeat(deps, roomId, watch.seat);
      if (res.ok) {
        deps.broadcast.toRoom(roomId, {
          type: "chat",
          playerId: "table",
          name: "The table",
          text: `${holder?.name ?? "A player"} timed out — a bot played for them. They can take the seat back at any time.`,
          at: Date.now()
        });
      }
      await watchTable(roomId);
    }
  }
}

export { sweep };
