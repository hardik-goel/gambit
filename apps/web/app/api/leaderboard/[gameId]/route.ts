import { NextResponse } from "next/server";
import { displayRating, isProvisional } from "@gambit/core";
import { CATALOG } from "@gambit/games";
import { leaderboard } from "@/lib/server/ratings";
import { readIdentity } from "@/lib/server/identity";
import { getRating } from "@/lib/server/ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  if (!CATALOG[gameId]) {
    return NextResponse.json(
      { error: { code: "unknown-game", message: "That game isn't on the shelf." } },
      { status: 404 }
    );
  }
  const me = await readIdentity();
  const rows = leaderboard(gameId).map((row, i) => ({
    place: i + 1,
    playerId: row.playerId,
    rating: displayRating(row.rating),
    games: row.rating.games,
    provisional: isProvisional(row.rating)
  }));

  const mine = me ? getRating(me.playerId, gameId) : null;
  return NextResponse.json({
    gameId,
    rows,
    you: mine ? { rating: displayRating(mine), games: mine.games, provisional: isProvisional(mine) } : null
  });
}
