/**
 * The Quintet bot.
 *
 * It thinks in fives: every empty square is worth whatever the best five-window
 * through it is worth, for me and for the opponent I'm most afraid of. Level 1
 * plays loose, level 2 blocks, level 3 counts both sides properly.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { CELLS, SIZE, isOneEyed, isTwoEyed } from "./layout";
import type { QuintetMove, QuintetView } from "./state";

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
] as const;

/** Every five-window containing `cell`, as arrays of cell indexes. */
function windows(cell: number): number[][] {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const out: number[][] = [];
  for (const [dr, dc] of DIRS) {
    for (let offset = -4; offset <= 0; offset++) {
      const win: number[] = [];
      let ok = true;
      for (let i = 0; i < 5; i++) {
        const rr = r + dr * (offset + i);
        const cc = c + dc * (offset + i);
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) {
          ok = false;
          break;
        }
        win.push(rr * SIZE + cc);
      }
      if (ok) out.push(win);
    }
  }
  return out;
}

/** How close is `team` to owning a five through this cell, if they take it? */
function threat(chips: (number | null)[], cell: number, team: number): number {
  let best = 0;
  for (const win of windows(cell)) {
    let mine = 0;
    let blocked = false;
    for (const c of win) {
      const on = chips[c];
      if (on === null || c === cell) continue;
      if (on === team || on === -1) mine++;
      else {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    // 4 of mine + this one = a completed five; weight steeply so the bot
    // always takes the win and always blocks the loss.
    best = Math.max(best, [1, 4, 12, 40, 900][mine] ?? 900);
  }
  return best;
}

const CENTRE_BONUS = (cell: number): number => {
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  return 6 - (Math.abs(r - 4.5) + Math.abs(c - 4.5)) / 2;
};

export function bot(view: QuintetView, legal: QuintetMove[], rng: Rng, level: BotLevel): QuintetMove {
  if (legal.length === 1) return legal[0]!;
  const team = view.seat === "spectator" ? 0 : (view.seatTeam[view.seat] ?? 0);
  const rivals = [...new Set(Object.values(view.seatTeam))].filter((t) => t !== team);

  const worth = (move: QuintetMove): number => {
    if (move.kind === "pass") return -1000;
    if (move.kind === "exchange") return -50; // only when nothing better exists

    if (move.kind === "remove") {
      // Lift the chip that was doing the most work for the other side.
      const on = view.chips[move.cell];
      if (on === null || on === team) return -100;
      const chipsWithout = view.chips.slice();
      chipsWithout[move.cell] = null;
      // `on` is the team whose chip this is — never null here, but the
      // compiler wants that said out loud.
      return threat(chipsWithout, move.cell, on ?? 0) * 0.9;
    }

    let value = threat(view.chips, move.cell, team) + CENTRE_BONUS(move.cell);
    if (level >= 2) {
      const danger = Math.max(0, ...rivals.map((r) => threat(view.chips, move.cell, r)));
      // Blocking is worth slightly less than winning, so a bot that can do
      // both does the winning one.
      value += danger * 0.85;
    }
    // Spending a wild jack on an ordinary square is a waste of a wild jack.
    if (isTwoEyed(move.card) && value < 60) value -= 45;
    if (isOneEyed(move.card)) value -= 20;
    if (level === 1) value += rng.raw() * 25;
    else value += rng.raw() * 2;
    return value;
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

export { windows as fiveWindows, CELLS };
