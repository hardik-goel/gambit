import { SHELF_META } from "@gambit/games/meta";
import { Lobby } from "./Lobby";

/**
 * The shelf renders from generated metadata rather than from the catalogue, so
 * the front door never downloads a rule engine. See scripts/gen-shelf-meta.ts.
 */
export default function HomePage() {
  return <Lobby games={SHELF_META} />;
}
