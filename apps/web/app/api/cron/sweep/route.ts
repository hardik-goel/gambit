import { NextResponse } from "next/server";
import { takeOverIdleSeat } from "@gambit/core";
import { deps, store } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The turn clock, for a deployment with no long-lived process.
 *
 * A container keeps a `setInterval` sweeping the live tables (see
 * `lib/server/timeouts.ts`). Serverless has no such thing, so Vercel Cron calls
 * this once a minute and it does the same job: any seat that has sat past its
 * table's clock has a bot play one move for it. The human takes the seat back
 * by moving, exactly as before.
 *
 * Guarded by CRON_SECRET so it is a scheduler's endpoint and not the internet's.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "no" }, { status: 401 });
    }
  }

  const now = Date.now();
  const rooms = await store.listPlayingRooms?.();
  if (!rooms) {
    // A store that cannot list live tables simply has nothing to sweep.
    return NextResponse.json({ swept: 0, covered: 0, note: "store has no live-room listing" });
  }

  let covered = 0;
  for (const room of rooms) {
    if (room.turnTimeoutSec <= 0) continue;
    const def = deps.catalog[room.gameId];
    const snap = await store.getSnapshot(room.id);
    if (!def || !snap) continue;

    const seat = def.currentSeats(snap.state)[0];
    if (seat === undefined) continue;

    const holder = room.players.find((p) => p.seat === seat);
    if (!holder || holder.isBot) continue;

    // Without a per-turn timestamp the best signal available is the snapshot's
    // own age: nothing has been written to this table since then.
    const idleFor = (now - snap.updatedAt) / 1000;
    if (idleFor < room.turnTimeoutSec) continue;

    const res = await takeOverIdleSeat(deps, room.id, seat);
    if (res.ok) {
      covered++;
      deps.broadcast.toRoom(room.id, {
        type: "chat",
        playerId: "table",
        name: "The table",
        text: `${holder.name} timed out — a bot played for them. They can take the seat back at any time.`,
        at: now
      });
    }
  }

  return NextResponse.json({ swept: rooms.length, covered });
}
