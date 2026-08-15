import { NextResponse } from "next/server";
import { submitMove } from "@gambit/core";
import { requireIdentity } from "@/lib/server/identity";
import { deps } from "@/lib/server/table";
import { rateLimit } from "@/lib/server/rateLimit";
import { watchTable } from "@/lib/server/timeouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one write path a game move can take. Idempotency-keyed, so a client that
 * retries through a flaky tunnel never double-moves.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await requireIdentity();

  if (!rateLimit(`move:${me.playerId}`, 40, 10_000)) {
    return NextResponse.json(
      { error: { code: "rate", message: "Slow down a moment." } },
      { status: 429 }
    );
  }

  const body = (await req.json()) as {
    move?: unknown;
    idempotencyKey?: string;
    clientVersion?: number;
  };
  if (!body.idempotencyKey) {
    return NextResponse.json(
      { error: { code: "no-key", message: "That move was missing its key." } },
      { status: 400 }
    );
  }

  const res = await submitMove(deps, {
    roomId: id,
    playerId: me.playerId,
    move: body.move,
    idempotencyKey: body.idempotencyKey,
    clientVersion: body.clientVersion
  });

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });

  // Whoever is to move next is now on the clock.
  void watchTable(id);
  return NextResponse.json(res.value);
}
