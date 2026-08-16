import { NextResponse } from "next/server";
import { NAME_COOKIE, PID_COOKIE, readIdentity } from "@/lib/server/identity";
import { exportRatings, eraseRatings } from "@/lib/server/ratings";
import { eraseSocial, exportSocial } from "@/lib/server/social";
import { store } from "@/lib/server/table";
import { rateLimit } from "@/lib/server/rateLimit";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your data: all of it, or none of it.
 *
 * `GET` returns everything Gambit holds about the caller, as a file they can
 * keep. `DELETE` erases it and signs them out.
 *
 * One honest limit, stated in the payload itself: a finished game is also the
 * other players' record of their evening. Deleting yours would take their
 * replay with it, so past tables keep their shape and the person in them
 * becomes "Former player" — unlinked from you, and not re-identifiable from
 * anything left behind.
 */
export async function GET() {
  const me = await readIdentity();
  if (!me) {
    return NextResponse.json(
      { error: { code: "no-identity", message: "Nothing is held about you yet." } },
      { status: 404 }
    );
  }

  const rooms = (await store.listOpenRooms()).filter((r) =>
    r.players.some((p) => p.playerId === me.playerId)
  );

  const payload = {
    exportedAt: new Date().toISOString(),
    identity: { playerId: me.playerId, name: me.name },
    social: exportSocial(me.playerId),
    ratings: exportRatings(me.playerId),
    openTables: rooms.map((r) => ({ code: r.code, gameId: r.gameId, status: r.status })),
    note:
      "Finished games are shared records: they are kept, with your seat unlinked from you. " +
      "Everything else here is deleted when you ask."
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="gambit-my-data.json"`
    }
  });
}

export async function DELETE() {
  const me = await readIdentity();
  if (!me) return NextResponse.json({ ok: true, note: "nothing to delete" });
  if (!rateLimit(`erase:${me.playerId}`, 3, 60_000)) {
    return NextResponse.json(
      { error: { code: "rate", message: "Give that a moment." } },
      { status: 429 }
    );
  }

  // Leave any table first, so nobody is left waiting on a seat that is gone.
  for (const room of await store.listOpenRooms()) {
    if (room.players.some((p) => p.playerId === me.playerId)) {
      await store.removePlayer(room.id, me.playerId);
    }
  }

  eraseSocial(me.playerId);
  eraseRatings(me.playerId);

  const jar = await cookies();
  jar.delete(PID_COOKIE);
  jar.delete(NAME_COOKIE);

  return NextResponse.json({
    ok: true,
    erased: ["profile", "friends", "blocks", "invites", "ratings", "table seats", "identity"],
    kept: "finished games, with your seat unlinked from you"
  });
}
