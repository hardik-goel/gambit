import { NextResponse } from "next/server";
import { createRoom } from "@gambit/core";
import { CATALOG } from "@gambit/games";
import { requireIdentity } from "@/lib/server/identity";
import { deps } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await requireIdentity();
  const body = (await req.json()) as {
    gameId?: string;
    config?: Record<string, unknown>;
    passAndPlay?: boolean;
    /** Seconds a seat may sit on its turn before a bot covers it. 0 turns it off. */
    turnTimeoutSec?: number;
  };

  if (!body.gameId || !CATALOG[body.gameId]) {
    return NextResponse.json(
      { error: { code: "unknown-game", message: "That game isn't on the shelf." } },
      { status: 400 }
    );
  }

  // A table clock of zero means "no clock"; anything else is kept inside sane
  // bounds so nobody can open a room that hands seats to bots instantly.
  const requested = body.turnTimeoutSec;
  const turnTimeoutSec =
    requested === undefined ? 90 : requested <= 0 ? 0 : Math.min(600, Math.max(10, Math.round(requested)));

  const res = await createRoom(deps, {
    gameId: body.gameId,
    host: { playerId: me.playerId, name: me.name },
    config: body.config,
    passAndPlay: body.passAndPlay ?? false,
    turnTimeoutSec
  });

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ room: res.value });
}
