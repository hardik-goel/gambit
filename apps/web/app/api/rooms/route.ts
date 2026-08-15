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
  };

  if (!body.gameId || !CATALOG[body.gameId]) {
    return NextResponse.json(
      { error: { code: "unknown-game", message: "That game isn't on the shelf." } },
      { status: 400 }
    );
  }

  const res = await createRoom(deps, {
    gameId: body.gameId,
    host: { playerId: me.playerId, name: me.name },
    config: body.config,
    passAndPlay: body.passAndPlay ?? false
  });

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ room: res.value });
}
