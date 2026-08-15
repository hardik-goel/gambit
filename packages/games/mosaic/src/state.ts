/**
 * Mosaic — draft beauty, punish greed.
 *
 * Take every tile of one colour from one factory; whatever you can't use falls
 * on your floor and costs you. The wall pattern is a Latin square: each colour
 * appears once in every row and once in every column, shifted one step per row.
 */
import {
  clone,
  err,
  ok,
  rankScores,
  Rng,
  type BaseState,
  type FinalScore,
  type GameEvent,
  type Result,
  type Seat,
  type SeatId
} from "@gambit/sdk";
import { z } from "zod";

export const COLOURS = ["azure", "saffron", "rose", "slate", "jade"] as const;
export type Colour = 0 | 1 | 2 | 3 | 4;
export const COLOUR_HEX = ["#3f7f9a", "#c9973f", "#a8556a", "#4a5468", "#4b8a63"];

export const FLOOR_PENALTIES = [-1, -1, -2, -2, -2, -3, -3];
export const ROWS = 5;
export const WALL = 5;
export const TILES_PER_COLOUR = 20;
export const TILES_PER_FACTORY = 4;

/** Which colour belongs in each wall cell. Row r, column c. */
export const wallColour = (row: number, col: number): Colour => (((col - row + WALL) % WALL) as Colour);
export const wallColumnFor = (row: number, colour: Colour): number => (colour + row) % WALL;

export const configSchema = z.object({
  /** The variant wall lets you choose where a colour goes; v1 ships the classic. */
  wall: z.enum(["fixed"]).default("fixed")
});

export type MosaicConfig = z.infer<typeof configSchema>;

export type MosaicMove = {
  kind: "take";
  /** Factory index, or -1 for the middle of the table. */
  source: number;
  colour: Colour;
  /** Pattern row 0–4, or -1 to drop the lot on the floor. */
  row: number;
};

export interface PlayerBoard {
  /** Five staging rows, capacity 1 to 5. */
  rows: { colour: Colour | null; count: number }[];
  /** wall[row][col] — true once tiled. */
  wall: boolean[][];
  /** Tiles that missed, plus possibly the first-player token (-1). */
  floor: number[];
  score: number;
}

export interface MosaicState extends BaseState {
  bag: Colour[];
  lid: Colour[];
  factories: Colour[][];
  centre: Colour[];
  /** The first-player token is still in the middle. */
  tokenInCentre: boolean;
  boards: Record<SeatId, PlayerBoard>;
  names: Record<SeatId, string>;
  turn: SeatId;
  /** Who starts the next round — whoever took from the middle first. */
  nextStarter: SeatId;
  round: number;
  finished: boolean;
}

function freshBoard(): PlayerBoard {
  return {
    rows: Array.from({ length: ROWS }, () => ({ colour: null, count: 0 })),
    wall: Array.from({ length: WALL }, () => Array.from({ length: WALL }, () => false)),
    floor: [],
    score: 0
  };
}

function freshBag(): Colour[] {
  const bag: Colour[] = [];
  for (let c = 0; c < 5; c++) for (let i = 0; i < TILES_PER_COLOUR; i++) bag.push(c as Colour);
  return bag;
}

export const factoryCount = (players: number): number => players * 2 + 1;

/** Draw from the bag, refilling it from the lid when it runs dry. */
function draw(state: MosaicState, n: number): Colour[] {
  const out: Colour[] = [];
  for (let i = 0; i < n; i++) {
    if (state.bag.length === 0) {
      if (state.lid.length === 0) break;
      const rng = Rng.from(state.rng);
      state.bag = rng.shuffle(state.lid);
      state.lid = [];
      state.rng = rng.serialize();
    }
    out.push(state.bag.shift()!);
  }
  return out;
}

function fillFactories(state: MosaicState): void {
  state.factories = Array.from({ length: factoryCount(state.seatCount) }, () =>
    draw(state, TILES_PER_FACTORY)
  );
  state.centre = [];
  state.tokenInCentre = true;
}

export function createState(_config: MosaicConfig, seats: Seat[], seed: string): MosaicState {
  const rng = new Rng(seed);
  const boards: Record<SeatId, PlayerBoard> = {};
  const names: Record<SeatId, string> = {};
  for (const s of seats) {
    boards[s.id] = freshBoard();
    names[s.id] = s.name;
  }

  const state: MosaicState = {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    bag: rng.shuffle(freshBag()),
    lid: [],
    factories: [],
    centre: [],
    tokenInCentre: true,
    boards,
    names,
    turn: seats[0]!.id,
    nextStarter: seats[0]!.id,
    round: 1,
    finished: false
  };
  state.rng = rng.serialize();
  fillFactories(state);
  return state;
}

export function currentSeats(state: MosaicState): SeatId[] {
  return state.finished ? [] : [state.turn];
}

const coloursIn = (tiles: Colour[]): Colour[] => [...new Set(tiles)].sort();

/** Can this row take that colour at all? */
export function rowAccepts(board: PlayerBoard, row: number, colour: Colour): boolean {
  if (row < 0) return true; // the floor takes anything
  const line = board.rows[row]!;
  if (board.wall[row]![wallColumnFor(row, colour)]) return false; // already on the wall
  if (line.count >= row + 1) return false; // full
  return line.colour === null || line.colour === colour;
}

export function legalMoves(state: MosaicState, seat: SeatId): MosaicMove[] {
  if (state.finished || state.turn !== seat) return [];
  const board = state.boards[seat]!;
  const moves: MosaicMove[] = [];

  const sources: [number, Colour[]][] = state.factories.map((f, i) => [i, f]);
  sources.push([-1, state.centre]);

  for (const [source, tiles] of sources) {
    for (const colour of coloursIn(tiles)) {
      for (let row = 0; row < ROWS; row++) {
        if (rowAccepts(board, row, colour)) moves.push({ kind: "take", source, colour, row });
      }
      // Dumping on the floor is always allowed — sometimes it is even correct.
      moves.push({ kind: "take", source, colour, row: -1 });
    }
  }
  return moves;
}

export function applyMove(
  state: MosaicState,
  seat: SeatId,
  move: MosaicMove
): Result<{ state: MosaicState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  if (state.turn !== seat) return err("not-your-turn", "Wait for your turn.");
  if ((move as { kind?: string })?.kind !== "take") {
    return err("unknown-move", "That isn't a move this game understands.");
  }
  const { source, colour, row } = move;
  if (typeof source !== "number" || typeof colour !== "number" || typeof row !== "number") {
    return err("bad-move", "That isn't a move this game understands.");
  }

  const next = clone(state);
  const board = next.boards[seat]!;
  const events: GameEvent[] = [];

  const pool = source === -1 ? next.centre : next.factories[source];
  if (!pool) return err("no-factory", "There's no factory there.");
  const taken = pool.filter((t) => t === colour).length;
  if (taken === 0) return err("no-colour", "There are no tiles of that colour there.");
  if (row >= 0 && !rowAccepts(board, row, colour)) {
    const line = board.rows[row]!;
    if (board.wall[row]![wallColumnFor(row, colour)]) {
      return err("on-wall", "That colour is already on your wall in that row.");
    }
    if (line.count >= row + 1) return err("row-full", "That row is already full.");
    return err("row-colour", "A row can only hold one colour at a time.");
  }

  if (source === -1) {
    next.centre = next.centre.filter((t) => t !== colour);
    if (next.tokenInCentre) {
      // First into the middle takes the token — and the penalty that rides on it.
      next.tokenInCentre = false;
      next.nextStarter = seat;
      board.floor.push(-1);
      events.push({
        type: "first-token",
        seat,
        text: `${next.names[seat]} takes the first-player token.`,
        sfx: "tileSnap"
      });
    }
  } else {
    const rest = pool.filter((t) => t !== colour);
    next.factories[source] = [];
    next.centre.push(...rest);
  }

  let placed = 0;
  if (row >= 0) {
    const line = board.rows[row]!;
    line.colour = colour;
    const space = row + 1 - line.count;
    placed = Math.min(space, taken);
    line.count += placed;
  }
  const overflow = taken - placed;
  for (let i = 0; i < overflow; i++) {
    if (board.floor.length < FLOOR_PENALTIES.length) board.floor.push(colour);
    else next.lid.push(colour); // the floor is full; the rest goes back in the box
  }

  next.ply++;
  events.push({
    type: "draft",
    seat,
    text: `${next.names[seat]} takes ${taken} ${COLOURS[colour]}${
      row >= 0 ? ` into row ${row + 1}` : " straight onto the floor"
    }.`,
    data: { colour, taken, row, source },
    sfx: "tileSnap"
  });

  const empty = next.factories.every((f) => f.length === 0) && next.centre.length === 0;
  if (empty) {
    events.push(...tileWall(next));
  } else {
    next.turn = nextActiveSeat(next, seat);
  }

  return ok({ state: next, events });
}

function nextActiveSeat(state: MosaicState, seat: SeatId): SeatId {
  return (seat + 1) % state.seatCount;
}

/** End of round: full rows move to the wall, floors bite, the table refills. */
function tileWall(state: MosaicState): GameEvent[] {
  const events: GameEvent[] = [];

  for (let seat = 0; seat < state.seatCount; seat++) {
    const board = state.boards[seat]!;
    for (let row = 0; row < ROWS; row++) {
      const line = board.rows[row]!;
      if (line.colour === null || line.count < row + 1) continue;
      const col = wallColumnFor(row, line.colour);
      board.wall[row]![col] = true;
      const gained = scoreTile(board, row, col);
      board.score += gained;
      // The rest of the row goes back in the box.
      for (let i = 0; i < row; i++) state.lid.push(line.colour);
      line.colour = null;
      line.count = 0;
      events.push({
        type: "tile",
        seat,
        text: `${state.names[seat]} tiles row ${row + 1} for ${gained}.`,
        data: { row, col, gained },
        sfx: "score"
      });
    }

    let penalty = 0;
    board.floor.forEach((tile, i) => {
      penalty += FLOOR_PENALTIES[i] ?? FLOOR_PENALTIES.at(-1)!;
      if (tile >= 0) state.lid.push(tile as Colour);
    });
    if (penalty !== 0) {
      board.score = Math.max(0, board.score + penalty);
      events.push({
        type: "floor",
        seat,
        text: `${state.names[seat]} loses ${-penalty} on the floor.`,
        sfx: "error"
      });
    }
    board.floor = [];
  }

  // The game ends after the round in which someone completes a wall row.
  const done = Object.values(state.boards).some((b) => b.wall.some((r) => r.every(Boolean)));
  if (done) {
    state.finished = true;
    for (let seat = 0; seat < state.seatCount; seat++) {
      const board = state.boards[seat]!;
      board.score += endBonus(board);
    }
    events.push({ type: "game-end", text: "A wall row is complete — the mosaic is finished.", sfx: "win" });
    return events;
  }

  state.round++;
  state.turn = state.nextStarter;
  fillFactories(state);

  // If bag and lid are both exhausted there is nothing left to draft; the
  // mosaic is as finished as it is going to get.
  if (state.factories.every((f) => f.length === 0)) {
    state.finished = true;
    for (let seat = 0; seat < state.seatCount; seat++) {
      state.boards[seat]!.score += endBonus(state.boards[seat]!);
    }
    events.push({ type: "game-end", text: "The tiles have run out.", sfx: "score" });
    return events;
  }

  events.push({ type: "round", text: `Round ${state.round}.`, sfx: "bagDraw" });
  return events;
}

/**
 * A tile scores the length of every run it joins — horizontal and vertical —
 * or one point flat if it stands alone.
 */
export function scoreTile(board: PlayerBoard, row: number, col: number): number {
  let h = 1;
  for (let c = col - 1; c >= 0 && board.wall[row]![c]; c--) h++;
  for (let c = col + 1; c < WALL && board.wall[row]![c]; c++) h++;
  let v = 1;
  for (let r = row - 1; r >= 0 && board.wall[r]![col]; r--) v++;
  for (let r = row + 1; r < WALL && board.wall[r]![col]; r++) v++;
  if (h === 1 && v === 1) return 1;
  return (h > 1 ? h : 0) + (v > 1 ? v : 0);
}

export function endBonus(board: PlayerBoard): number {
  let bonus = 0;
  for (let r = 0; r < WALL; r++) if (board.wall[r]!.every(Boolean)) bonus += 2;
  for (let c = 0; c < WALL; c++) if (board.wall.every((row) => row[c])) bonus += 7;
  for (let colour = 0; colour < 5; colour++) {
    const all = board.wall.every((row, r) => row[wallColumnFor(r, colour as Colour)]);
    if (all) bonus += 10;
  }
  return bonus;
}

export function isTerminal(state: MosaicState): boolean {
  return state.finished;
}

export function score(state: MosaicState): FinalScore[] {
  const entries = Object.keys(state.boards)
    .map(Number)
    .map((seat) => {
      const board = state.boards[seat]!;
      const rows = board.wall.filter((r) => r.every(Boolean)).length;
      const cols = Array.from({ length: WALL }, (_, c) => board.wall.every((r) => r[c])).filter(Boolean).length;
      const colours = Array.from({ length: 5 }, (_, colour) =>
        board.wall.every((row, r) => row[wallColumnFor(r, colour as Colour)])
      ).filter(Boolean).length;
      const bonus = rows * 2 + cols * 7 + colours * 10;
      return {
        seat,
        total: board.score,
        lines: [
          { label: "Tiles", value: board.score - bonus },
          { label: "Rows", value: rows * 2 },
          { label: "Columns", value: cols * 7 },
          { label: "Colours", value: colours * 10 }
        ]
      };
    });
  // Ties go to the player with more complete wall rows.
  return rankScores(entries, (a, b) => {
    const rowsOf = (s: SeatId) => state.boards[s]!.wall.filter((r) => r.every(Boolean)).length;
    return rowsOf(b) - rowsOf(a);
  });
}

export interface MosaicView {
  factories: Colour[][];
  centre: Colour[];
  tokenInCentre: boolean;
  boards: Record<SeatId, PlayerBoard>;
  names: Record<SeatId, string>;
  turn: SeatId;
  round: number;
  bagCount: number;
  lidCount: number;
  finished: boolean;
  seat: SeatId | "spectator";
}

/**
 * Mosaic is an open-information game — every board and every factory is on the
 * table. The bag is not: its contents stay hidden, and only its size is shown.
 */
export function redactStateFor(state: MosaicState, viewer: SeatId | "spectator"): MosaicView {
  return {
    factories: state.factories.map((f) => f.slice()),
    centre: state.centre.slice(),
    tokenInCentre: state.tokenInCentre,
    boards: clone(state.boards),
    names: { ...state.names },
    turn: state.turn,
    round: state.round,
    bagCount: state.bag.length,
    lidCount: state.lid.length,
    finished: state.finished,
    seat: viewer
  };
}

export function predict(view: MosaicView, seat: SeatId, move: MosaicMove): MosaicView {
  if (move.kind !== "take") return view;
  const next = clone(view);
  const pool = move.source === -1 ? next.centre : next.factories[move.source];
  if (!pool) return view;
  const taken = pool.filter((t) => t === move.colour).length;
  if (taken === 0) return view;

  if (move.source === -1) {
    next.centre = next.centre.filter((t) => t !== move.colour);
    if (next.tokenInCentre) {
      next.tokenInCentre = false;
      next.boards[seat]!.floor.push(-1);
    }
  } else {
    next.centre.push(...pool.filter((t) => t !== move.colour));
    next.factories[move.source] = [];
  }

  const board = next.boards[seat]!;
  let placed = 0;
  if (move.row >= 0) {
    const line = board.rows[move.row]!;
    line.colour = move.colour;
    placed = Math.min(move.row + 1 - line.count, taken);
    line.count += placed;
  }
  for (let i = 0; i < taken - placed; i++) {
    if (board.floor.length < FLOOR_PENALTIES.length) board.floor.push(move.colour);
  }
  return next;
}

export function describeMove(state: MosaicState, _seat: SeatId, move: MosaicMove): string {
  return `takes ${COLOURS[move.colour]}${move.row >= 0 ? ` into row ${move.row + 1}` : " to the floor"}`;
}

/** A hundred tiles exist. They are always all somewhere. */
export function invariants(state: MosaicState): string | void {
  let total = state.bag.length + state.lid.length + state.centre.length;
  for (const f of state.factories) total += f.length;
  for (const board of Object.values(state.boards)) {
    total += board.rows.reduce((n, r) => n + r.count, 0);
    total += board.floor.filter((t) => t >= 0).length;
    total += board.wall.flat().filter(Boolean).length;
  }
  if (total !== 100) return `tile count is ${total}, should be 100`;

  for (const board of Object.values(state.boards)) {
    if (board.score < 0) return "a score went below zero";
    board.rows.forEach((line, row) => {
      if (line.count > row + 1) return;
    });
    for (let row = 0; row < ROWS; row++) {
      const line = board.rows[row]!;
      if (line.count > row + 1) return `row ${row + 1} holds ${line.count} tiles`;
      if (line.count > 0 && line.colour === null) return "a staged row has tiles but no colour";
    }
  }
  return undefined;
}
