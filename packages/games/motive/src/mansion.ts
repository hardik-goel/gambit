/**
 * Motive's mansion: nine rooms in a three-by-three arrangement, joined by a
 * grid of corridor squares, with two secret passages between opposite corners.
 *
 * The house, its people and its implements are all original to Gambit.
 */

export const SUSPECTS = [
  "Dr Ashcroft",
  "Mrs Pike",
  "Colonel Bellamy",
  "Miss Frost",
  "Mr Wren",
  "Lady Marlowe"
];

export const IMPLEMENTS = [
  "Letter Opener",
  "Fire Iron",
  "Silk Cord",
  "Brass Bookend",
  "Duelling Pistol",
  "Poisoned Decanter"
];

export const ROOMS = [
  "Orangery",
  "Map Room",
  "Long Gallery",
  "Smoking Room",
  "Servants' Hall",
  "Wine Cellar",
  "Observatory",
  "Music Room",
  "Winter Garden"
];

export type CardKind = "suspect" | "implement" | "room";
export interface Card {
  id: string;
  kind: CardKind;
  index: number;
  name: string;
}

export const CARDS: Card[] = [
  ...SUSPECTS.map((name, index) => ({ id: `s${index}`, kind: "suspect" as const, index, name })),
  ...IMPLEMENTS.map((name, index) => ({ id: `i${index}`, kind: "implement" as const, index, name })),
  ...ROOMS.map((name, index) => ({ id: `r${index}`, kind: "room" as const, index, name }))
];

export const cardById = (id: string): Card => CARDS.find((c) => c.id === id)!;
export const suspectCard = (index: number): string => `s${index}`;
export const implementCard = (index: number): string => `i${index}`;
export const roomCard = (index: number): string => `r${index}`;

/* --------------------------------------------------------------- the grid */

export const SIZE = 11;
/** The two columns and two rows that are corridor rather than room. */
const CORRIDOR_LINES = [3, 7];

export const isCorridor = (x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < SIZE && y < SIZE && (CORRIDOR_LINES.includes(x) || CORRIDOR_LINES.includes(y));

const blockOf = (v: number): number => (v < 3 ? 0 : v < 7 ? 1 : 2);

/** The room a square belongs to, or null if it is corridor or off the map. */
export function roomAt(x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
  if (isCorridor(x, y)) return null;
  return blockOf(y) * 3 + blockOf(x);
}

export interface Door {
  room: number;
  /** The corridor square you stand on to go in or out. */
  x: number;
  y: number;
}

/** Every room's doors: the middle of each side that faces a corridor. */
export const DOORS: Door[] = (() => {
  const doors: Door[] = [];
  for (let room = 0; room < 9; room++) {
    const bx = room % 3;
    const by = Math.floor(room / 3);
    const x0 = bx * 4;
    const y0 = by * 4;
    const mid = 1;
    const candidates: [number, number][] = [
      [x0 + mid, y0 - 1], // north
      [x0 + 3, y0 + mid], // east
      [x0 + mid, y0 + 3], // south
      [x0 - 1, y0 + mid]  // west
    ];
    for (const [x, y] of candidates) {
      if (isCorridor(x, y)) doors.push({ room, x, y });
    }
  }
  return doors;
})();

export const doorsOf = (room: number): Door[] => DOORS.filter((d) => d.room === room);
export const doorAt = (x: number, y: number): Door[] => DOORS.filter((d) => d.x === x && d.y === y);

/** Opposite corners, joined under the floor. */
export const SECRET_PASSAGES: Record<number, number> = { 0: 8, 8: 0, 2: 6, 6: 2 };

export type Position = { kind: "room"; room: number } | { kind: "cell"; x: number; y: number };

export const samePosition = (a: Position, b: Position): boolean =>
  a.kind === "room" && b.kind === "room"
    ? a.room === b.room
    : a.kind === "cell" && b.kind === "cell"
      ? a.x === b.x && a.y === b.y
      : false;

const CORRIDOR_STEPS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
];

/**
 * Everywhere a pawn can finish a move of exactly up to `steps` squares.
 *
 * Corridors are walked one square at a time and never through another pawn.
 * A door costs one step to pass, and entering a room ends the move — which is
 * what makes the corner rooms so valuable and the middle of the house so slow.
 */
export function reachable(
  from: Position,
  steps: number,
  occupiedCells: { x: number; y: number }[]
): Position[] {
  const blocked = new Set(occupiedCells.map((c) => `${c.x},${c.y}`));
  const results = new Map<string, Position>();
  const seen = new Map<string, number>();
  const queue: { x: number; y: number; used: number }[] = [];

  if (from.kind === "cell") {
    seen.set(`${from.x},${from.y}`, 0);
    queue.push({ x: from.x, y: from.y, used: 0 });
  } else {
    // Leaving a room costs the step that carries you through its door.
    for (const door of doorsOf(from.room)) {
      if (blocked.has(`${door.x},${door.y}`)) continue;
      if (1 > steps) continue;
      const key = `${door.x},${door.y}`;
      seen.set(key, 1);
      queue.push({ x: door.x, y: door.y, used: 1 });
      results.set(`c:${key}`, { kind: "cell", x: door.x, y: door.y });
    }
  }

  while (queue.length) {
    const here = queue.shift()!;
    // Standing on a doorway, you may step inside — and that ends the move.
    for (const door of doorAt(here.x, here.y)) {
      if (here.used + 1 <= steps) {
        const target: Position = { kind: "room", room: door.room };
        if (!(from.kind === "room" && from.room === door.room)) {
          results.set(`r:${door.room}`, target);
        }
      }
    }
    if (here.used >= steps) continue;

    for (const [dx, dy] of CORRIDOR_STEPS) {
      const x = here.x + dx;
      const y = here.y + dy;
      if (!isCorridor(x, y)) continue;
      if (blocked.has(`${x},${y}`)) continue;
      const key = `${x},${y}`;
      const used = here.used + 1;
      if ((seen.get(key) ?? Infinity) <= used) continue;
      seen.set(key, used);
      queue.push({ x, y, used });
      results.set(`c:${key}`, { kind: "cell", x, y });
    }
  }

  return [...results.values()];
}

/** A sensible corridor square just outside each room, for the opening layout. */
export const START_POSITIONS: Position[] = [
  { kind: "cell", x: 3, y: 0 },
  { kind: "cell", x: 7, y: 0 },
  { kind: "cell", x: 10, y: 3 },
  { kind: "cell", x: 10, y: 7 },
  { kind: "cell", x: 7, y: 10 },
  { kind: "cell", x: 3, y: 10 },
  { kind: "cell", x: 0, y: 7 },
  { kind: "cell", x: 0, y: 3 }
];
