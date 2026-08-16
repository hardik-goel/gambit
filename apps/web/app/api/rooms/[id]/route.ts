import { NextResponse } from "next/server";
import { clientSnapshot, joinRoom } from "@gambit/core";
import { requireIdentity } from "@/lib/server/identity";
import { displayName } from "@/lib/server/social";
import { deps, setSubscriberSeat } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One round trip gives a joining or reconnecting client everything: the room,
 * its own seat, the redacted view, its legal moves and the events it missed.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await requireIdentity();
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);

  const joined = await joinRoom(deps, id, {
    playerId: me.playerId,
    name: displayName(me.playerId, me.name)
  });
  if (!joined.ok) return NextResponse.json({ error: joined.error }, { status: 404 });

  const snap = await clientSnapshot(deps, id, me.playerId, since);
  if (!snap) {
    return NextResponse.json(
      { error: { code: "no-room", message: "That table no longer exists." } },
      { status: 404 }
    );
  }
  setSubscriberSeat(me.playerId, id, snap.seat);
  return NextResponse.json({ ...snap, me });
}
