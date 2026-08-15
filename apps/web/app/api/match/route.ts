import { NextResponse } from "next/server";
import { lobbyCounts, quickMatch } from "@gambit/core";
import { CATALOG } from "@gambit/games";
import { requireIdentity } from "@/lib/server/identity";
import { deps } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is waiting, per game — the lobby shows this next to each box. */
export async function GET() {
  return NextResponse.json({ waiting: await lobbyCounts(deps) });
}

export async function POST(req: Request) {
  const me = await requireIdentity();
  const body = (await req.json()) as { gameId?: string; target?: number };
  if (!body.gameId || !CATALOG[body.gameId]) {
    return NextResponse.json(
      { error: { code: "unknown-game", message: "That game isn't on the shelf." } },
      { status: 400 }
    );
  }
  const res = await quickMatch(deps, {
    gameId: body.gameId,
    player: { playerId: me.playerId, name: me.name },
    target: body.target
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json(res.value);
}
