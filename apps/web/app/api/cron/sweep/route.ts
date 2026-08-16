import { NextResponse } from "next/server";
import { store } from "@/lib/server/table";
import { sweepRoom, sweepStaleLobbies } from "@/lib/server/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The backstop.
 *
 * Tables are swept by the people sitting at them (see `lib/server/sweep.ts`),
 * which covers every table anybody is waiting on. This catches the rest: a game
 * everyone has closed the tab on, left mid-turn, and which would otherwise sit
 * in "playing" for ever.
 *
 * It runs once a day, because that is what Vercel's Hobby plan allows, and once
 * a day is the right frequency for the case it exists to handle. Guarded by
 * CRON_SECRET so it is a scheduler's endpoint and not the internet's.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization");
    if (header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "no" }, { status: 401 });
    }
  }

  const rooms = await store.listPlayingRooms?.();
  if (!rooms) {
    // A store that cannot list live tables simply has nothing to sweep.
    return NextResponse.json({ swept: 0, covered: 0, note: "store has no live-room listing" });
  }

  let covered = 0;
  for (const room of rooms) {
    const result = await sweepRoom(room.id);
    if (result.covered) covered++;
  }

  // And the lobbies nobody ever sat down at, which would otherwise stay on the
  // shelf for ever.
  const closed = await sweepStaleLobbies();

  return NextResponse.json({ swept: rooms.length, covered, lobbiesClosed: closed });
}
