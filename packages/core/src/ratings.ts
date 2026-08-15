/**
 * Ratings — Glicko-lite, per game.
 *
 * Full Glicko-2 assumes rating periods and a volatility term that only earns
 * its keep at scale. This is the useful half: a rating, a deviation that grows
 * while you are away and shrinks as you play, and an update that moves an
 * uncertain player further than a settled one.
 *
 * Multiplayer results are handled as a round robin: every pair of seats is
 * scored against each other, which gives sensible numbers for a five-player
 * table without inventing a new maths.
 */
import type { FinalScore, SeatId } from "@gambit/sdk";

export interface Rating {
  rating: number;
  deviation: number;
  games: number;
}

export const NEW_RATING: Rating = { rating: 1500, deviation: 350, games: 0 };

/** Deviations grow with idleness so a returning player moves quickly again. */
export const MIN_DEVIATION = 45;
export const MAX_DEVIATION = 350;
const Q = Math.log(10) / 400;

const g = (deviation: number): number => 1 / Math.sqrt(1 + (3 * Q * Q * deviation * deviation) / (Math.PI * Math.PI));

const expected = (rating: number, against: Rating): number =>
  1 / (1 + Math.pow(10, (-g(against.deviation) * (rating - against.rating)) / 400));

/**
 * One player's new rating against a set of opponents and outcomes
 * (1 win, 0.5 draw, 0 loss).
 */
export function updateRating(
  player: Rating,
  results: { opponent: Rating; score: number }[]
): Rating {
  if (results.length === 0) return player;

  let variance = 0;
  let change = 0;
  for (const { opponent, score } of results) {
    const e = expected(player.rating, opponent);
    const gi = g(opponent.deviation);
    variance += gi * gi * e * (1 - e);
    change += gi * (score - e);
  }
  const dSquaredInverse = Q * Q * variance;
  const denominator = 1 / (player.deviation * player.deviation) + dSquaredInverse;
  const rating = player.rating + (Q / denominator) * change;
  const deviation = Math.max(MIN_DEVIATION, Math.min(MAX_DEVIATION, Math.sqrt(1 / denominator)));

  return {
    rating: Math.round(rating * 10) / 10,
    deviation: Math.round(deviation * 10) / 10,
    games: player.games + results.length
  };
}

/**
 * Apply a finished table to everybody's rating. Draws and shared places are
 * handled properly: two players on the same rank score half against each other.
 */
export function applyResult(
  ratings: Record<SeatId, Rating>,
  scores: FinalScore[]
): Record<SeatId, Rating> {
  const out: Record<SeatId, Rating> = {};
  for (const me of scores) {
    const mine = ratings[me.seat] ?? { ...NEW_RATING };
    const results = scores
      .filter((other) => other.seat !== me.seat)
      .map((other) => ({
        opponent: ratings[other.seat] ?? { ...NEW_RATING },
        score: me.rank < other.rank ? 1 : me.rank > other.rank ? 0 : 0.5
      }));
    out[me.seat] = updateRating(mine, results);
  }
  return out;
}

/** A rating you can put on a card: the conservative end of the range. */
export const displayRating = (r: Rating): number => Math.round(r.rating - r.deviation / 2);

/** Placement games: until you have played five, the rating is provisional. */
export const isProvisional = (r: Rating): boolean => r.games < 5;

/** Idleness widens the deviation, up to the ceiling. */
export function decay(r: Rating, daysIdle: number): Rating {
  if (daysIdle <= 0) return r;
  const widened = Math.sqrt(r.deviation * r.deviation + daysIdle * 4.5);
  return { ...r, deviation: Math.min(MAX_DEVIATION, Math.round(widened * 10) / 10) };
}
