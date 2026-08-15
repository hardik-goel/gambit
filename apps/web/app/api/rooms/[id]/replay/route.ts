import { NextResponse } from "next/server";
import { buildReplay, seatsFromRoom } from "@gambit/core";
import { CATALOG } from "@gambit/games";
import { store } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replay theatre: rebuild a finished table move by move from its log. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = await store.getRoom(id);
  if (!room) {
    return NextResponse.json(
      { error: { code: "no-room", message: "That table no longer exists." } },
      { status: 404 }
    );
  }
  const def = CATALOG[room.gameId];
  if (!def) {
    return NextResponse.json(
      { error: { code: "unknown-game", message: "That game isn't installed." } },
      { status: 400 }
    );
  }
  const moves = await store.getMoves(id);
  const { frames, scores } = buildReplay(def, {
    seats: seatsFromRoom(room),
    seed: room.seed,
    config: room.config,
    moves
  });
  return NextResponse.json({
    gameId: room.gameId,
    code: room.code,
    seats: seatsFromRoom(room),
    frames,
    scores
  });
}
