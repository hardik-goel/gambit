/**
 * The Mosaic bot.
 *
 * It values a draft by what the tiles are worth where they land — the wall
 * points they will eventually earn, the rows they complete — minus what falls
 * on the floor, and (from level 2) minus what the take hands to the next player.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import {
  FLOOR_PENALTIES,
  ROWS,
  WALL,
  scoreTile,
  wallColumnFor,
  type Colour,
  type MosaicMove,
  type MosaicView,
  type PlayerBoard
} from "./state";

function floorCost(board: PlayerBoard, extra: number): number {
  let cost = 0;
  for (let i = 0; i < extra; i++) {
    const slot = board.floor.length + i;
    cost += -(FLOOR_PENALTIES[slot] ?? FLOOR_PENALTIES.at(-1)!);
  }
  return cost;
}

/** What the wall cell would score if this row were completed and tiled. */
function tileValue(board: PlayerBoard, row: number, colour: Colour): number {
  const col = wallColumnFor(row, colour);
  const trial: PlayerBoard = {
    ...board,
    wall: board.wall.map((r) => r.slice())
  };
  trial.wall[row]![col] = true;
  let value = scoreTile(trial, row, col);

  // Rows, columns and colour sets are worth chasing near the end.
  if (trial.wall[row]!.every(Boolean)) value += 6;
  if (trial.wall.every((r) => r[col])) value += 8;
  const colourDone = trial.wall.every((r, i) => r[wallColumnFor(i, colour)]);
  if (colourDone) value += 10;
  return value;
}

export function bot(view: MosaicView, legal: MosaicMove[], rng: Rng, level: BotLevel): MosaicMove {
  if (legal.length <= 1) return legal[0]!;
  const seat = view.seat === "spectator" ? view.turn : view.seat;
  const board = view.boards[seat]!;

  const worth = (move: MosaicMove): number => {
    const pool = move.source === -1 ? view.centre : (view.factories[move.source] ?? []);
    const taken = pool.filter((t) => t === move.colour).length;
    if (taken === 0) return -Infinity;

    if (move.row < 0) {
      return -floorCost(board, taken) - 2;
    }

    const line = board.rows[move.row]!;
    const space = move.row + 1 - line.count;
    const placed = Math.min(space, taken);
    const overflow = taken - placed;
    const completes = placed === space;

    let value = placed * 1.4;
    if (completes) {
      value += tileValue(board, move.row, move.colour) * 1.8;
      // Finishing a long row this round beats hoarding a short one.
      value += move.row * 0.6;
    } else {
      // A half-filled long row is a liability if the colour dries up.
      value -= (space - placed) * 0.5;
    }
    value -= floorCost(board, overflow) * 1.3;

    if (move.source === -1 && view.tokenInCentre) {
      // The token costs a point now but sets the order next round.
      value -= 1.2;
      if (level >= 2 && view.round >= 3) value += 1.6;
    }

    if (level >= 2) {
      // Leaving a big pile in the middle is a gift to the next player.
      const leftovers = move.source === -1 ? 0 : (view.factories[move.source]?.length ?? 0) - taken;
      value -= leftovers * 0.35;
    }
    if (level >= 3) {
      // Prefer colours that still have plenty in circulation.
      const remaining = view.factories.flat().concat(view.centre).filter((t) => t === move.colour).length;
      value += Math.min(remaining, 6) * 0.15;
    }

    return value + (level === 1 ? rng.raw() * 3 : rng.raw() * 0.4);
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

export { ROWS, WALL };
