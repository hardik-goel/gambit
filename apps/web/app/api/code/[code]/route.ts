import { NextResponse } from "next/server";
import { normalizeCode } from "@gambit/core";
import { store } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve a share code to a room. This is what a scanned QR lands on. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = await store.getRoomByCode(normalizeCode(code));
  if (!room) {
    return NextResponse.json(
      { error: { code: "no-room", message: "No table with that code." } },
      { status: 404 }
    );
  }
  return NextResponse.json({ roomId: room.id, gameId: room.gameId, status: room.status });
}
