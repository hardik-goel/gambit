import { notFound } from "next/navigation";
import { CATALOG } from "@gambit/games";
import { Tutorial } from "./Tutorial";

export const dynamic = "force-dynamic";

/** The two-minute first hand. Runs entirely on the device — no table needed. */
export default async function LearnPage(ctx: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await ctx.params;
  if (!CATALOG[gameId]) notFound();
  return <Tutorial gameId={gameId} />;
}
