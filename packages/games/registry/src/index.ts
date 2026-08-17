/**
 * The shelf, in code.
 *
 * This file is the entire cost of adding a game to Gambit: import the package,
 * add it to CATALOG. Nothing in `core`, `ui` or `apps/web` changes — see
 * ADDING_A_GAME.md.
 */
import type { AnyGameDefinition } from "@gambit/sdk";
import chess from "@gambit/game-chess";
import quintet from "@gambit/game-quintet";
import mosaic from "@gambit/game-mosaic";
import facet from "@gambit/game-facet";
import boxcar from "@gambit/game-boxcar";
import hamlet from "@gambit/game-hamlet";
import stronghold from "@gambit/game-stronghold";
import phantom from "@gambit/game-phantom";
import motive from "@gambit/game-motive";
import landfall from "@gambit/game-landfall";
import remedy from "@gambit/game-remedy";

export const CATALOG: Record<string, AnyGameDefinition> = {
  remedy,
  landfall,
  motive,
  phantom,
  stronghold,
  hamlet,
  boxcar,
  facet,
  mosaic,
  chess,
  quintet
};

/** Shelf order — how the boxes stand on the plank. */
export const SHELF_ORDER = [
  "chess",
  "boxcar",
  "landfall",
  "quintet",
  "phantom",
  "motive",
  "hamlet",
  "mosaic",
  "facet",
  "stronghold",
  "remedy"
];

export const GAME_IDS = SHELF_ORDER.filter((id) => id in CATALOG);

export function getGame(id: string): AnyGameDefinition | null {
  return CATALOG[id] ?? null;
}

/** Everything the Shelf needs to draw a box spine, derived from the games. */
export function shelfEntries() {
  return GAME_IDS.map((id) => {
    const g = CATALOG[id]!;
    return {
      id,
      name: g.meta.name,
      tagline: g.meta.tagline,
      kind: g.meta.kind,
      familiar: g.meta.familiar,
      blurb: g.meta.blurb,
      players:
        g.meta.minPlayers === g.meta.maxPlayers
          ? String(g.meta.minPlayers)
          : `${g.meta.minPlayers}–${g.meta.maxPlayers}`,
      minutes: g.meta.avgMinutes,
      complexity: g.meta.complexity,
      badges: g.meta.badges,
      hue: g.meta.themeTokens.hue,
      felt: g.meta.themeTokens.felt,
      minPlayers: g.meta.minPlayers,
      maxPlayers: g.meta.maxPlayers
    };
  });
}
