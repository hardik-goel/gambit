import { SHELF_META } from "@gambit/games/meta";
import { Lobby } from "./Lobby";

/**
 * The shelf renders from generated metadata rather than from the catalogue, so
 * the front door never downloads a rule engine. See scripts/gen-shelf-meta.ts.
 */
export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const asked = (await searchParams).game;
  const wanted = typeof asked === "string" ? asked : undefined;
  // Chosen here rather than after hydration: a link to a game should render
  // that game, not render chess and then change its mind. Anything unknown
  // falls through to the first spine.
  const initial = SHELF_META.some((g) => g.id === wanted) ? wanted : undefined;
  return <Lobby games={SHELF_META} initialGameId={initial} />;
}
