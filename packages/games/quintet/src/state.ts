/** Quintet: play a card, place a chip, read the board. */
import {
  clone,
  err,
  nextSeat,
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
import {
  BOARD,
  CARD_CELLS,
  CELLS,
  CORNERS,
  drawDeck,
  isOneEyed,
  isTwoEyed,
  runsThrough,
  type Card
} from "./layout";

export const TEAM_NAMES = ["Blue", "Green", "Amber"];
export const TEAM_HUES = ["#3c6ea8", "#4d8a52", "#c08a2e"];

export const configSchema = z.object({
  /** Two teams need two sequences to win; three teams need one. */
  teams: z.enum(["2", "3"]).default("2"),
  /** Free-for-all seats each get their own colour, up to three. */
  mode: z.enum(["teams", "solo"]).default("teams")
});

export type QuintetConfig = z.infer<typeof configSchema>;

export type QuintetMove =
  | { kind: "play"; card: Card; cell: number }
  | { kind: "remove"; card: Card; cell: number }
  | { kind: "exchange"; card: Card }
  | { kind: "pass" };

export interface Sequence {
  team: number;
  cells: number[];
}

export interface QuintetState extends BaseState {
  /** Team index per cell; -1 for the wild corners; null for empty. */
  chips: (number | null)[];
  /** Cells that belong to a completed sequence — safe from one-eyed jacks. */
  locked: boolean[];
  hands: Record<SeatId, Card[]>;
  deck: Card[];
  discard: Card[];
  seatTeam: Record<SeatId, number>;
  teamCount: number;
  names: Record<SeatId, string>;
  turn: SeatId;
  /** One dead-card exchange per turn. */
  exchanged: boolean;
  sequences: Sequence[];
  /** How many sequences a team needs; two-team games need two. */
  target: number;
  /** Consecutive passes — a full lap of them means the board is finished. */
  passStreak: number;
  winner: number | null;
  /** True when a full lap of passes ended it with nobody at the target. */
  exhausted: boolean;
}

const HAND_SIZES: [number, number][] = [
  [2, 7],
  [4, 6],
  [6, 5],
  [9, 4],
  [12, 3]
];

export function handSize(players: number): number {
  for (const [upTo, size] of HAND_SIZES) if (players <= upTo) return size;
  return 3;
}

export function createState(config: QuintetConfig, seats: Seat[], seed: string): QuintetState {
  const rng = new Rng(seed);
  const teamCount = config.mode === "solo" ? Math.min(3, seats.length) : Number(config.teams);
  const deck = rng.shuffle(drawDeck());
  const hands: Record<SeatId, Card[]> = {};
  const names: Record<SeatId, string> = {};
  const seatTeam: Record<SeatId, number> = {};
  const size = handSize(seats.length);

  let cursor = 0;
  seats.forEach((s, i) => {
    hands[s.id] = deck.slice(cursor, cursor + size);
    cursor += size;
    names[s.id] = s.name;
    // Teams alternate around the table, so partners never sit together.
    seatTeam[s.id] = i % teamCount;
  });

  const chips: (number | null)[] = Array(CELLS).fill(null);
  for (const corner of CORNERS) chips[corner] = -1;

  return {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    chips,
    locked: Array(CELLS).fill(false),
    hands,
    deck: deck.slice(cursor),
    discard: [],
    seatTeam,
    teamCount,
    names,
    turn: seats[0]!.id,
    exchanged: false,
    sequences: [],
    target: teamCount === 2 ? 2 : 1,
    passStreak: 0,
    winner: null,
    exhausted: false
  };
}

export function currentSeats(state: QuintetState): SeatId[] {
  return state.winner === null ? [state.turn] : [];
}

const owner = (state: QuintetState) => (cell: number) => state.chips[cell] ?? null;

/** A card is dead when both of its cells are already occupied. */
export function isDead(state: QuintetState, card: Card): boolean {
  if (isTwoEyed(card)) return state.chips.every((c, i) => c !== null || CORNERS.includes(i));
  if (isOneEyed(card)) {
    return !state.chips.some(
      (c, i) => c !== null && c !== -1 && c !== state.seatTeam[state.turn] && !state.locked[i]
    );
  }
  return (CARD_CELLS.get(card) ?? []).every((cell) => state.chips[cell] !== null);
}

export function legalMoves(state: QuintetState, seat: SeatId): QuintetMove[] {
  if (state.winner !== null || state.turn !== seat) return [];
  const hand = state.hands[seat] ?? [];
  const team = state.seatTeam[seat]!;
  const moves: QuintetMove[] = [];

  for (const card of new Set(hand)) {
    if (isTwoEyed(card)) {
      for (let cell = 0; cell < CELLS; cell++) {
        if (state.chips[cell] === null) moves.push({ kind: "play", card, cell });
      }
    } else if (isOneEyed(card)) {
      for (let cell = 0; cell < CELLS; cell++) {
        const on = state.chips[cell];
        if (on !== null && on !== -1 && on !== team && !state.locked[cell]) {
          moves.push({ kind: "remove", card, cell });
        }
      }
    } else {
      for (const cell of CARD_CELLS.get(card) ?? []) {
        if (state.chips[cell] === null) moves.push({ kind: "play", card, cell });
      }
    }
  }

  if (!state.exchanged) {
    for (const card of new Set(hand)) {
      if (isDead(state, card)) moves.push({ kind: "exchange", card });
    }
  }

  // A hand of nothing but dead cards after the exchange is spent still has to
  // do something; passing keeps the table moving rather than freezing it.
  if (moves.length === 0) moves.push({ kind: "pass" });
  return moves;
}

function drawUp(state: QuintetState, seat: SeatId, size: number): void {
  const hand = state.hands[seat]!;
  while (hand.length < size) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break;
      const rng = Rng.from(state.rng);
      state.deck = rng.shuffle(state.discard);
      state.discard = [];
      state.rng = rng.serialize();
    }
    hand.push(state.deck.shift()!);
  }
}

export function applyMove(
  state: QuintetState,
  seat: SeatId,
  move: QuintetMove
): Result<{ state: QuintetState; events: GameEvent[] }> {
  if (state.winner !== null) return err("finished", "This game is already won.");
  if (state.turn !== seat) return err("not-your-turn", "Wait for your turn.");
  const kind = (move as { kind?: string })?.kind;
  if (!kind || !["play", "remove", "exchange", "pass"].includes(kind)) {
    return err("unknown-move", "That isn't a move this game understands.");
  }

  const next = clone(state);
  const hand = next.hands[seat]!;
  const team = next.seatTeam[seat]!;
  const size = handSize(state.seatCount);
  const events: GameEvent[] = [];

  if (kind === "exchange") {
    const { card } = move as { card: Card };
    const at = hand.indexOf(card);
    if (at < 0) return err("not-in-hand", "That card isn't in your hand.");
    if (state.exchanged) return err("already-exchanged", "One dead card per turn.");
    if (!isDead(state, card)) return err("not-dead", "Both of that card's squares are still open.");
    hand.splice(at, 1);
    next.discard.push(card);
    drawUp(next, seat, size);
    next.exchanged = true;
    next.passStreak = 0;
    next.ply++;
    events.push({
      type: "exchange",
      seat,
      text: `${next.names[seat]} swaps a dead card.`,
      sfx: "cardSlip"
    });
    return ok({ state: next, events });
  }

  if (kind === "pass") {
    if (legalMoves(state, seat).some((m) => m.kind !== "pass")) {
      return err("can-play", "You still have a card you can play.");
    }
    next.turn = nextSeat(seat, state.seatCount);
    next.exchanged = false;
    next.passStreak = state.passStreak + 1;
    next.ply++;
    events.push({ type: "pass", seat, text: `${next.names[seat]} can't play, and passes.` });

    // A full lap of passes means nobody can move again: the board is done, and
    // whoever is ahead on completed fives takes it.
    if (next.passStreak >= state.seatCount) {
      next.exhausted = true;
      const counts = new Map<number, number>();
      for (const s of next.sequences) counts.set(s.team, (counts.get(s.team) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      next.winner = best ? best[0] : -1;
      events.push({
        type: "exhausted",
        text: "Nobody can play — the board is finished.",
        sfx: "score"
      });
    }
    return ok({ state: next, events });
  }

  const { card, cell } = move as { card: Card; cell: number };
  const at = hand.indexOf(card);
  if (at < 0) return err("not-in-hand", "That card isn't in your hand.");
  if (cell < 0 || cell >= CELLS) return err("off-board", "That square isn't on the board.");

  if (kind === "remove") {
    if (!isOneEyed(card)) return err("not-a-remover", "Only a one-eyed jack takes a chip off.");
    const on = next.chips[cell];
    if (on === null) return err("empty", "There's no chip on that square.");
    if (on === -1) return err("corner", "Corners belong to everyone; they can't be taken.");
    if (on === team) return err("own-chip", "You can't remove your own team's chip.");
    if (next.locked[cell]) return err("locked", "That chip is part of a finished five.");

    next.chips[cell] = null;
    hand.splice(at, 1);
    next.discard.push(card);
    drawUp(next, seat, size);
    next.turn = nextSeat(seat, state.seatCount);
    next.exchanged = false;
    next.passStreak = 0;
    next.ply++;
    events.push({
      type: "remove",
      seat,
      text: `${next.names[seat]} lifts a ${TEAM_NAMES[on ?? 0]} chip.`,
      data: { cell },
      sfx: "chipClack"
    });
    return ok({ state: next, events });
  }

  // kind === "play"
  if (next.chips[cell] !== null) return err("occupied", "Someone's chip is already there.");
  if (!isTwoEyed(card) && !(CARD_CELLS.get(card) ?? []).includes(cell)) {
    return err("wrong-square", "That square doesn't show that card.");
  }

  next.chips[cell] = team;
  hand.splice(at, 1);
  next.discard.push(card);
  drawUp(next, seat, size);
  next.passStreak = 0;
  next.ply++;
  events.push({
    type: "place",
    seat,
    text: `${next.names[seat]} plays ${card}.`,
    data: { cell, team },
    sfx: "chipClack"
  });

  // A new five may share at most one chip with a five that team already has.
  for (const run of runsThrough(cell, team, owner(next))) {
    const overlap = (existing: Sequence) => run.filter((c) => existing.cells.includes(c)).length;
    const clash = next.sequences.filter((s) => s.team === team).some((s) => overlap(s) > 1);
    if (clash) continue;
    if (next.sequences.some((s) => s.team === team && s.cells.join() === run.join())) continue;

    next.sequences.push({ team, cells: run });
    for (const c of run) next.locked[c] = true;
    events.push({
      type: "sequence",
      seat,
      text: `${TEAM_NAMES[team]} completes a five.`,
      data: { cells: run, team },
      sfx: "claim"
    });
  }

  const mine = next.sequences.filter((s) => s.team === team).length;
  if (mine >= next.target) {
    next.winner = team;
    events.push({
      type: "win",
      seat,
      text: `${TEAM_NAMES[team]} takes the game.`,
      sfx: "win"
    });
  } else {
    next.turn = nextSeat(seat, state.seatCount);
    next.exchanged = false;
  }

  return ok({ state: next, events });
}

export function isTerminal(state: QuintetState): boolean {
  return state.winner !== null;
}

export function score(state: QuintetState): FinalScore[] {
  const entries = Object.keys(state.seatTeam)
    .map(Number)
    .map((seat) => {
      const team = state.seatTeam[seat]!;
      const seqs = state.sequences.filter((s) => s.team === team).length;
      const chips = state.chips.filter((c) => c === team).length;
      return {
        seat,
        total: seqs * 100 + chips,
        lines: [
          { label: "Sequences", value: seqs },
          { label: "Chips on the board", value: chips }
        ]
      };
    });
  const ranked = rankScores(entries);
  // A board that ran out with nobody at the target is decided on the ranking
  // above; otherwise the winning team takes it outright.
  if (state.winner !== null && state.winner >= 0) {
    for (const r of ranked) r.won = state.seatTeam[r.seat] === state.winner;
  }
  return ranked;
}

export interface QuintetView {
  chips: (number | null)[];
  locked: boolean[];
  board: readonly (Card | null)[];
  hand: Card[];
  handCounts: Record<SeatId, number>;
  seatTeam: Record<SeatId, number>;
  names: Record<SeatId, string>;
  teamCount: number;
  turn: SeatId;
  exchanged: boolean;
  sequences: Sequence[];
  target: number;
  deckCount: number;
  winner: number | null;
  seat: SeatId | "spectator";
  /** Which of the viewer's cards are dead, so the tray can grey them out. */
  dead: Card[];
}

export function redactStateFor(state: QuintetState, viewer: SeatId | "spectator"): QuintetView {
  const hand = viewer === "spectator" ? [] : (state.hands[viewer] ?? []);
  const handCounts: Record<SeatId, number> = {};
  for (const [seat, cards] of Object.entries(state.hands)) handCounts[Number(seat)] = cards.length;

  return {
    chips: state.chips.slice(),
    locked: state.locked.slice(),
    board: BOARD,
    hand: hand.slice(),
    handCounts,
    seatTeam: { ...state.seatTeam },
    names: { ...state.names },
    teamCount: state.teamCount,
    turn: state.turn,
    exchanged: state.exchanged,
    sequences: state.sequences.map((s) => ({ team: s.team, cells: s.cells.slice() })),
    target: state.target,
    deckCount: state.deck.length,
    winner: state.winner,
    seat: viewer,
    dead: hand.filter((c) => isDead(state, c))
  };
}

/** Your own chip lands the instant you tap; the replacement card waits. */
export function predict(view: QuintetView, seat: SeatId, move: QuintetMove): QuintetView {
  if (move.kind === "play") {
    const chips = view.chips.slice();
    chips[move.cell] = view.seatTeam[seat] ?? null;
    return { ...view, chips, hand: removeOne(view.hand, move.card) };
  }
  if (move.kind === "remove") {
    const chips = view.chips.slice();
    chips[move.cell] = null;
    return { ...view, chips, hand: removeOne(view.hand, move.card) };
  }
  return view;
}

function removeOne(hand: Card[], card: Card): Card[] {
  const i = hand.indexOf(card);
  return i < 0 ? hand : [...hand.slice(0, i), ...hand.slice(i + 1)];
}

export function describeMove(_state: QuintetState, _seat: SeatId, move: QuintetMove): string {
  switch (move.kind) {
    case "play": return `plays ${move.card}`;
    case "remove": return `removes a chip with ${move.card}`;
    case "exchange": return `swaps ${move.card}`;
    default: return "passes";
  }
}

/** Cards are conserved: hands + deck + discard + played always equals the deck. */
export function invariants(state: QuintetState): string | void {
  const inHands = Object.values(state.hands).reduce((n, h) => n + h.length, 0);
  const total = inHands + state.deck.length + state.discard.length;
  if (total !== 104) return `card count is ${total}, should be 104`;
  const corners = CORNERS.filter((c) => state.chips[c] !== -1);
  if (corners.length) return "a corner lost its wild chip";
  for (const s of state.sequences) {
    if (s.cells.length !== 5) return "a recorded sequence is not five long";
    if (!s.cells.every((c) => state.locked[c])) return "a sequence cell is not locked";
  }
  return undefined;
}
