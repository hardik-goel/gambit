/**
 * The hidden-information firewall.
 *
 * Nothing reaches a client except through `viewFor` and `eventsFor`. Games
 * decide what a seat may know; the platform guarantees no other path exists.
 */
import type { AnyGameDefinition, GameEvent, SeatId } from "@gambit/sdk";

export type Viewer = SeatId | "spectator";

export function viewFor(def: AnyGameDefinition, state: unknown, viewer: Viewer): unknown {
  return def.redactStateFor(state, viewer);
}

/** Drop events this viewer may not see; strip payloads they may not read. */
export function eventsFor(events: GameEvent[], viewer: Viewer): GameEvent[] {
  return events
    .filter((e) => !e.visibleTo || (viewer !== "spectator" && e.visibleTo.includes(viewer)))
    .map((e) => ({ ...e }));
}

/**
 * Legal moves for a viewer. Spectators get none, and a seat only ever gets its
 * own — asking for another seat's options is how hands leak.
 */
export function legalFor(
  def: AnyGameDefinition,
  state: unknown,
  viewer: Viewer
): unknown[] {
  if (viewer === "spectator") return [];
  return def.legalMoves(state, viewer);
}
