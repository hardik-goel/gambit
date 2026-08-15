import { NextResponse } from "next/server";
import { requireIdentity } from "@/lib/server/identity";
import { deps } from "@/lib/server/table";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await requireIdentity();
  if (!rateLimit(`chat:${me.playerId}`, 12, 10_000)) {
    return NextResponse.json({ error: { code: "rate", message: "Easy on the chat." } }, { status: 429 });
  }
  const body = (await req.json()) as { text?: string; emote?: string };
  const text = (body.text ?? "").slice(0, 280).trim();
  if (!text && !body.emote) return NextResponse.json({ ok: true });

  deps.broadcast.toRoom(id, {
    type: "chat",
    playerId: me.playerId,
    name: me.name,
    text,
    emote: body.emote,
    at: Date.now()
  });
  return NextResponse.json({ ok: true });
}
