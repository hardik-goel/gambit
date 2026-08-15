/**
 * The Hamlet bot.
 *
 * It asks two questions of every placement: does this finish something of mine,
 * and does it open something worth standing on? Level 1 answers roughly, level
 * 3 also notices when a placement hands a neighbour a finished keep.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { DELTA, tileById } from "./tiles";
import type { HamletMove, HamletView } from "./state";

const key = (x: number, y: number): string => `${x},${y}`;

export function bot(view: HamletView, legal: HamletMove[], rng: Rng, level: BotLevel): HamletMove {
  if (legal.length <= 1) return legal[0]!;
  const seat = view.seat === "spectator" ? view.turn : view.seat;
  const tile = view.drawn ? tileById(view.drawn) : null;
  const meeplesLeft = view.meeplesLeft[seat] ?? 0;

  const neighbours = (x: number, y: number): number =>
    DELTA.filter(([dx, dy]) => view.tiles[key(x + dx, y + dy)]).length;

  const diagonals = (x: number, y: number): number => {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (view.tiles[key(x + dx, y + dy)]) n++;
      }
    }
    return n;
  };

  const worth = (move: HamletMove): number => {
    if (move.kind === "discard") return -100;
    let value = 0;

    // Placing into a well-enclosed spot tends to close features.
    value += neighbours(move.x, move.y) * 1.6;

    if (move.meeple) {
      if (meeplesLeft <= 1) value -= 4; // keep one in reserve
      switch (move.meeple.kind) {
        case "keep":
          value += 7 + (tile?.banner ? 3 : 0);
          break;
        case "shrine":
          // A shrine wants eight neighbours; one already surrounded is gold.
          value += 5 + diagonals(move.x, move.y) * 0.8;
          break;
        case "road":
          value += 4;
          break;
        case "field":
          // Fields only pay at the end, and only if keeps get finished.
          value += level >= 2 && view.bagCount < 20 ? 4 : 0.5;
          break;
      }
      if (level === 1) value += rng.raw() * 3;
    } else {
      // Not claiming is fine when the meeple supply is thin.
      value += meeplesLeft <= 2 ? 2 : 0;
    }

    if (level >= 3) {
      // A tile that finishes something for somebody else is worth less.
      const crowded = diagonals(move.x, move.y);
      value -= crowded * 0.3;
    }
    return value + rng.raw() * (level === 1 ? 4 : 0.8);
  };

  let best = legal[0]!;
  let bestScore = -Infinity;
  for (const move of legal) {
    const v = worth(move);
    if (v > bestScore) {
      bestScore = v;
      best = move;
    }
  }
  return best;
}
