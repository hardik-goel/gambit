import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/rateLimit";
import { requireIdentity } from "@/lib/server/identity";
import { sweepRoom } from "@/lib/server/sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Has the player to move run out of time?"
 *
 * Asked by whoever is waiting, because on a serverless deployment there is no
 * process to ask on their behalf. The answer is computed from the server's own
 * record of when the table was last written to, so asking early achieves
 * nothing: the caller cannot move the clock, only read it.
 *
 * Returns how long is left, which is how the caller knows when to ask again.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await requireIdentity();

  if (!rateLimit(`sweep:${me.playerId}:${id}`, 20, 60_000)) {
    return NextResponse.json({ covered: false, remaining: null, throttled: true });
  }

  const result = await sweepRoom(id);
  return NextResponse.json(result);
}
