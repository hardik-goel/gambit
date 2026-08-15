import { NextResponse } from "next/server";
import { heartbeat } from "@gambit/core";
import { requireIdentity } from "@/lib/server/identity";
import { deps } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await requireIdentity();
  await heartbeat(deps, id, me.playerId, true);
  return NextResponse.json({ ok: true });
}
