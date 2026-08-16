/**
 * Rating storage.
 *
 * In development this lives in memory alongside the rooms; in production the
 * same three functions read and write the `ratings` table. Keeping the surface
 * this small is what makes that swap a swap.
 */
import { NEW_RATING, applyResult, type Rating } from "@gambit/core";
import type { FinalScore, Seat } from "@gambit/sdk";

const g = globalThis as typeof globalThis & {
  __gambitRatings?: Map<string, Rating>;
};
if (!g.__gambitRatings) g.__gambitRatings = new Map();
const store = g.__gambitRatings;

const key = (playerId: string, gameId: string): string => `${gameId}:${playerId}`;

export function getRating(playerId: string, gameId: string): Rating {
  return store.get(key(playerId, gameId)) ?? { ...NEW_RATING };
}

/** Apply a finished table. Bots are rated too, and never displayed. */
export function recordRatings(gameId: string, seats: Seat[], scores: FinalScore[]): Record<number, Rating> {
  const before: Record<number, Rating> = {};
  for (const seat of seats) before[seat.id] = getRating(seat.playerId, gameId);
  const after = applyResult(before, scores);
  for (const seat of seats) {
    const updated = after[seat.id];
    if (updated) store.set(key(seat.playerId, gameId), updated);
  }
  return after;
}

export interface LeaderboardRow {
  playerId: string;
  gameId: string;
  rating: Rating;
}

/** Every rating this player holds, for the data export. */
export function exportRatings(playerId: string): Record<string, Rating> {
  const out: Record<string, Rating> = {};
  for (const [k, rating] of store.entries()) {
    const [gameId, id] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    if (id === playerId) out[gameId!] = rating;
  }
  return out;
}

export function eraseRatings(playerId: string): void {
  for (const k of [...store.keys()]) {
    if (k.slice(k.indexOf(":") + 1) === playerId) store.delete(k);
  }
}

export function leaderboard(gameId: string, limit = 20): LeaderboardRow[] {
  return [...store.entries()]
    .filter(([k]) => k.startsWith(`${gameId}:`))
    .map(([k, rating]) => ({ playerId: k.slice(gameId.length + 1), gameId, rating }))
    .filter((row) => !row.playerId.startsWith("bot:"))
    .sort((a, b) => b.rating.rating - a.rating.rating)
    .slice(0, limit);
}
