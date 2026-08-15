/**
 * Quintet's board.
 *
 * Ten by ten. Four wild corners. Every other cell carries one card face, and
 * every card outside the jacks appears exactly twice — so a card in your hand
 * always offers two choices, until someone takes one of them.
 *
 * The layout is generated here rather than transcribed from anywhere: a fixed
 * seed, a constrained shuffle that keeps a card's two faces apart, and the same
 * hundred cells on every device forever. Deterministic, and ours.
 */
import { Rng } from "@gambit/sdk";

export const SUITS = ["S", "H", "D", "C"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Q", "K"] as const;

export type Suit = (typeof SUITS)[number];
export type Card = string; // e.g. "AS", "10H", "JD"

/** Jacks with one eye in a traditional deck: the removers. */
export const ONE_EYED = ["JS", "JH"];
/** Jacks with two eyes: the wilds. */
export const TWO_EYED = ["JD", "JC"];

export const isJack = (card: Card): boolean => card.startsWith("J");
export const isOneEyed = (card: Card): boolean => ONE_EYED.includes(card);
export const isTwoEyed = (card: Card): boolean => TWO_EYED.includes(card);

export const CORNERS = [0, 9, 90, 99];
export const SIZE = 10;
export const CELLS = SIZE * SIZE;

/** The 96 non-jack faces, twice each. */
function faces(): Card[] {
  const out: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) out.push(`${rank}${suit}`);
  return [...out, ...out];
}

/** The full draw deck: two complete decks, jacks included. */
export function drawDeck(): Card[] {
  const out: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) out.push(`${rank}${suit}`);
    out.push(`J${suit}`);
  }
  return [...out, ...out];
}

const chebyshev = (a: number, b: number): number =>
  Math.max(Math.abs((a % SIZE) - (b % SIZE)), Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)));

/** Minimum king-move distance allowed between a card's two faces. */
export const MIN_PAIR_DISTANCE = 4;

function build(): (Card | null)[] {
  const rng = new Rng("gambit-quintet-board-v1");
  const open = Array.from({ length: CELLS }, (_, i) => i).filter((i) => !CORNERS.includes(i));

  const shuffled = rng.shuffle(faces());
  const placed: (Card | null)[] = Array(CELLS).fill(null);
  open.forEach((cell, i) => (placed[cell] = shuffled[i]!));

  const where = new Map<Card, [number, number]>();
  const record = () => {
    where.clear();
    for (const cell of open) {
      const card = placed[cell]!;
      const existing = where.get(card);
      if (existing) existing[1] = cell;
      else where.set(card, [cell, cell]);
    }
  };
  record();

  const gap = (card: Card): number => {
    const [a, b] = where.get(card)!;
    return chebyshev(a, b);
  };

  // Repair rather than reject: a rejection sampler would run for the age of the
  // universe before hitting a layout where all forty-eight pairs are far apart,
  // so instead we swap offending faces with random others until everything sits
  // at a comfortable distance. This converges in a few thousand swaps.
  for (let step = 0; step < 200_000; step++) {
    const bad = [...where.keys()].filter((card) => gap(card) < MIN_PAIR_DISTANCE);
    if (bad.length === 0) break;

    const card = bad[rng.int(bad.length)]!;
    const [a, b] = where.get(card)!;
    const from = rng.raw() < 0.5 ? a : b;
    const to = open[rng.int(open.length)]!;
    const other = placed[to]!;
    if (other === card || to === from) continue;

    placed[from] = other;
    placed[to] = card;
    record();
    // Undo any swap that makes the other card worse than the rule allows.
    if (gap(card) < MIN_PAIR_DISTANCE && gap(other) < MIN_PAIR_DISTANCE) {
      placed[from] = card;
      placed[to] = other;
      record();
    }
  }
  return placed;
}

/** The board, computed once, identical on every client and the server. */
export const BOARD: readonly (Card | null)[] = build();

/** Cell indexes showing a given card face. */
export const CARD_CELLS: ReadonlyMap<Card, number[]> = (() => {
  const map = new Map<Card, number[]>();
  BOARD.forEach((card, cell) => {
    if (!card) return;
    const list = map.get(card) ?? [];
    list.push(cell);
    map.set(card, list);
  });
  return map;
})();

const DIRECTIONS = [
  [0, 1],  // →
  [1, 0],  // ↓
  [1, 1],  // ↘
  [1, -1]  // ↙
] as const;

/**
 * Every run of five that includes `cell` and is entirely owned by `team`.
 * Corners belong to everyone, which is what makes them worth fighting over.
 */
export function runsThrough(
  cell: number,
  team: number,
  owner: (cell: number) => number | null
): number[][] {
  const runs: number[][] = [];
  const r = Math.floor(cell / SIZE);
  const c = cell % SIZE;
  const mine = (cc: number) => {
    const o = owner(cc);
    return o === team || o === -1; // -1 = wild corner
  };

  for (const [dr, dc] of DIRECTIONS) {
    // Slide a five-window along this direction, keeping only windows that
    // contain the cell just played.
    for (let offset = -4; offset <= 0; offset++) {
      const window: number[] = [];
      let ok = true;
      for (let i = 0; i < 5; i++) {
        const rr = r + dr * (offset + i);
        const cc = c + dc * (offset + i);
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) {
          ok = false;
          break;
        }
        const idx = rr * SIZE + cc;
        if (!mine(idx)) {
          ok = false;
          break;
        }
        window.push(idx);
      }
      if (ok && window.includes(cell)) runs.push(window);
    }
  }
  return runs;
}
