"use client";
/**
 * Client-side game loading.
 *
 * The server needs every game at once — it runs the rules for all of them. A
 * browser needs exactly one: the game on the table in front of it. Loading them
 * through this map means the bundler splits each game into its own chunk, so
 * opening a chess table never downloads the Boxcar maps.
 *
 * This is the file DECISIONS.md D12 promised.
 */
import type { AnyGameDefinition } from "@gambit/sdk";

const loaders: Record<string, () => Promise<{ default: AnyGameDefinition }>> = {
  chess: () => import("@gambit/game-chess"),
  boxcar: () => import("@gambit/game-boxcar"),
  landfall: () => import("@gambit/game-landfall"),
  quintet: () => import("@gambit/game-quintet"),
  phantom: () => import("@gambit/game-phantom"),
  motive: () => import("@gambit/game-motive"),
  hamlet: () => import("@gambit/game-hamlet"),
  mosaic: () => import("@gambit/game-mosaic"),
  facet: () => import("@gambit/game-facet"),
  stronghold: () => import("@gambit/game-stronghold"),
  remedy: () => import("@gambit/game-remedy")
};

const cache = new Map<string, AnyGameDefinition>();

export async function loadGame(gameId: string): Promise<AnyGameDefinition | null> {
  const cached = cache.get(gameId);
  if (cached) return cached;
  const load = loaders[gameId];
  if (!load) return null;
  const module = await load();
  cache.set(gameId, module.default);
  return module.default;
}

export const isKnownGame = (gameId: string): boolean => gameId in loaders;
