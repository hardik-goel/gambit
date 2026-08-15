import { notFound } from "next/navigation";
import { normalizeCode } from "@gambit/core";
import { store } from "@/lib/server/table";
import { Theatre } from "./Theatre";

export const dynamic = "force-dynamic";

/** Replay theatre: any finished table, rebuilt from its move log. */
export default async function ReplayPage(ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = await store.getRoomByCode(normalizeCode(code));
  if (!room) notFound();
  return <Theatre roomId={room.id} code={room.code} />;
}
