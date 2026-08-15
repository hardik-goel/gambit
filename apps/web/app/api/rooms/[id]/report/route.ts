import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/server/identity";
import { rateLimit } from "@/lib/server/rateLimit";
import { store } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reporting somebody at your table.
 *
 * Deliberately simple and deliberately cheap to use: a reason, an optional
 * note, and the room it happened in — which is enough to find the chat and the
 * move log afterwards. Muting is a separate, instant, client-side thing: you
 * should never have to file a report to stop reading someone.
 */
const REASONS = ["abuse", "cheating", "stalling", "spam", "other"] as const;

const g = globalThis as typeof globalThis & { __gambitReports?: unknown[] };
if (!g.__gambitReports) g.__gambitReports = [];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await requireIdentity();
  if (!rateLimit(`report:${me.playerId}`, 5, 60_000)) {
    return NextResponse.json(
      { error: { code: "rate", message: "You've filed a few already — give us a moment." } },
      { status: 429 }
    );
  }

  const body = (await req.json()) as { subjectId?: string; reason?: string; detail?: string };
  const reason = REASONS.includes(body.reason as (typeof REASONS)[number]) ? body.reason! : "other";

  const room = await store.getRoom(id);
  if (!room) {
    return NextResponse.json(
      { error: { code: "no-room", message: "That table no longer exists." } },
      { status: 404 }
    );
  }
  if (body.subjectId && !room.players.some((p) => p.playerId === body.subjectId)) {
    return NextResponse.json(
      { error: { code: "not-here", message: "That player isn't at this table." } },
      { status: 400 }
    );
  }

  g.__gambitReports!.push({
    roomId: id,
    gameId: room.gameId,
    reporterId: me.playerId,
    subjectId: body.subjectId ?? null,
    reason,
    detail: (body.detail ?? "").slice(0, 500),
    at: Date.now()
  });

  return NextResponse.json({ ok: true, filed: reason });
}
