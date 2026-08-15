import { notFound } from "next/navigation";
import { normalizeCode } from "@gambit/core";
import { store } from "@/lib/server/table";
import { RoomView } from "./RoomView";

export const dynamic = "force-dynamic";

/** `/r/CODE` is the whole invite: scan it, tap it, you're at the table. */
export default async function RoomPage(ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const room = await store.getRoomByCode(normalizeCode(code));
  if (!room) notFound();
  return <RoomView roomId={room.id} code={room.code} />;
}
