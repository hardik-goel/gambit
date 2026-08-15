/**
 * Phantom — one vanishes, everyone hunts.
 *
 * This is the platform's hidden-information stress test. The fugitive's
 * position lives in the state and reaches exactly one client: theirs. What the
 * detectives get is the move log — the *kind* of ticket used, never the node —
 * plus the five scheduled sightings. Every other seat's view is built from that
 * and nothing else.
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
import { CITY, FINAL_ROUND, REVEAL_ROUNDS, exitsFrom, type Transport } from "./city";

export const configSchema = z.object({
  /** Sightings can be made rarer for a harder hunt. */
  reveals: z.enum(["standard", "sparse"]).default("standard"),
  /** How many rounds the fugitive has to survive. */
  rounds: z.enum(["24", "18"]).default("24")
});

export type PhantomConfig = z.infer<typeof configSchema>;

export type PhantomMove =
  | { kind: "move"; to: number; transport: Transport | "black"; double?: boolean }
  | { kind: "stuck" };

export interface Tickets {
  cab: number;
  tram: number;
  metro: number;
  black: number;
  double: number;
}

export interface LogEntry {
  round: number;
  /** What the city saw. "black" hides the transport entirely. */
  transport: Transport | "black";
  /** Filled in only on the scheduled sightings. */
  node: number | null;
  double: boolean;
}

export interface PhantomState extends BaseState {
  fugitive: SeatId;
  detectives: SeatId[];
  positions: Record<SeatId, number>;
  tickets: Record<SeatId, Tickets>;
  log: LogEntry[];
  round: number;
  /** Whose move it is: the fugitive, then each detective in seat order. */
  toMove: SeatId;
  /** Set after a double move is declared; the fugitive moves again. */
  doubleRemaining: number;
  revealRounds: number[];
  finalRound: number;
  names: Record<SeatId, string>;
  winner: "fugitive" | "detectives" | null;
  finished: boolean;
}

export function createState(config: PhantomConfig, seats: Seat[], seed: string): PhantomState {
  const rng = new Rng(seed);
  // The fugitive seat is drawn at random, so nobody can plan around seat order.
  const fugitive = seats[rng.int(seats.length)]!.id;
  const detectives = seats.map((s) => s.id).filter((id) => id !== fugitive);

  const positions: Record<SeatId, number> = {};
  const tickets: Record<SeatId, Tickets> = {};
  const names: Record<SeatId, string> = {};

  const fugitivePool = rng.shuffle(CITY.fugitiveStarts);
  const detectivePool = rng.shuffle(CITY.detectiveStarts);
  positions[fugitive] = fugitivePool[0]!;
  detectives.forEach((seat, i) => {
    positions[seat] = detectivePool[i % detectivePool.length]!;
  });

  for (const seat of seats) {
    names[seat.id] = seat.name;
    tickets[seat.id] =
      seat.id === fugitive
        ? { cab: 0, tram: 0, metro: 0, black: detectives.length, double: 2 }
        : { cab: 10, tram: 8, metro: 4, black: 0, double: 0 };
  }

  const revealRounds =
    config.reveals === "sparse" ? REVEAL_ROUNDS.filter((_, i) => i % 2 === 0) : [...REVEAL_ROUNDS];

  return {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    fugitive,
    detectives,
    positions,
    tickets,
    log: [],
    round: 1,
    toMove: fugitive,
    doubleRemaining: 0,
    revealRounds,
    finalRound: Number(config.rounds),
    names,
    winner: null,
    finished: false
  };
}

export const isFugitive = (state: PhantomState, seat: SeatId): boolean => state.fugitive === seat;

export function currentSeats(state: PhantomState): SeatId[] {
  return state.finished ? [] : [state.toMove];
}

/** Whether this seat can pay for that transport. */
function canPay(tickets: Tickets, transport: Transport | "black"): boolean {
  if (transport === "black") return tickets.black > 0;
  if (transport === "river") return false; // only a black ticket crosses the river
  return tickets[transport] > 0;
}

export function legalMoves(state: PhantomState, seat: SeatId): PhantomMove[] {
  if (state.finished || state.toMove !== seat) return [];
  const from = state.positions[seat]!;
  const tickets = state.tickets[seat]!;
  const moves: PhantomMove[] = [];
  const detectiveNodes = state.detectives.map((d) => state.positions[d]!);

  for (const exit of exitsFrom(from)) {
    if (isFugitive(state, seat)) {
      // The fugitive may never step onto a detective.
      if (detectiveNodes.includes(exit.to)) continue;
      if (exit.transport !== "river" && canPay(tickets, exit.transport)) {
        // The fugitive pays with whatever the detectives have handed over.
        moves.push({ kind: "move", to: exit.to, transport: exit.transport });
      }
      if (tickets.black > 0) {
        moves.push({ kind: "move", to: exit.to, transport: "black" });
      }
    } else {
      // Detectives never share a node, and never touch the river.
      if (detectiveNodes.includes(exit.to)) continue;
      if (exit.transport === "river") continue;
      if (!canPay(tickets, exit.transport)) continue;
      moves.push({ kind: "move", to: exit.to, transport: exit.transport });
    }
  }

  if (isFugitive(state, seat) && tickets.double > 0 && state.doubleRemaining === 0) {
    // A double move is declared with the first of the two.
    for (const move of [...moves]) {
      if (move.kind === "move") moves.push({ ...move, double: true });
    }
  }

  // A detective with nowhere affordable to go stays put — and says so.
  if (moves.length === 0) moves.push({ kind: "stuck" });
  return moves;
}

export function applyMove(
  state: PhantomState,
  seat: SeatId,
  move: PhantomMove
): Result<{ state: PhantomState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  if (state.toMove !== seat) return err("not-your-turn", "Wait for your move.");
  const kind = (move as { kind?: string })?.kind;
  if (kind !== "move" && kind !== "stuck") {
    return err("unknown-move", "That isn't a move this game understands.");
  }

  const next = clone(state);
  const events: GameEvent[] = [];
  const fugitive = isFugitive(state, seat);

  if (kind === "stuck") {
    if (legalMoves(state, seat).some((m) => m.kind !== "stuck")) {
      return err("can-move", "You still have somewhere to go.");
    }
    next.ply++;
    events.push({
      type: "stuck",
      seat,
      text: `${next.names[seat]} has no ticket that goes anywhere.`,
      sfx: "error"
    });
    advance(next, events);
    return ok({ state: next, events });
  }

  const { to, transport, double } = move as Extract<PhantomMove, { kind: "move" }>;
  const from = next.positions[seat]!;
  // Two nodes can be joined by more than one kind of line, so the exit has to
  // match the ticket being offered as well as the destination.
  const exit =
    transport === "black"
      ? exitsFrom(from).find((e) => e.to === to)
      : exitsFrom(from).find((e) => e.to === to && e.transport === transport);
  if (!exit) return err("no-link", "There's no line of that kind from here to there.");

  const tickets = next.tickets[seat]!;
  if (transport === "black") {
    if (!fugitive) return err("no-black", "Only the fugitive holds black tickets.");
    if (tickets.black <= 0) return err("no-ticket", "You're out of black tickets.");
    tickets.black--;
  } else {
    if (exit.transport !== transport) return err("wrong-transport", "That line isn't served that way.");
    if (transport === "river") return err("river", "The river needs a black ticket.");
    if (tickets[transport] <= 0) return err("no-ticket", `You're out of ${transport} tickets.`);
    tickets[transport]--;
    // A detective's spent ticket goes straight into the fugitive's pocket.
    if (!fugitive) next.tickets[next.fugitive]![transport]++;
  }

  const detectiveNodes = next.detectives.filter((d) => d !== seat).map((d) => next.positions[d]!);
  if (detectiveNodes.includes(to)) {
    return fugitive
      ? err("occupied", "A detective is standing there.")
      : err("occupied", "Another detective is already there.");
  }

  next.positions[seat] = to;
  next.ply++;

  if (fugitive) {
    if (double) {
      if (tickets.double <= 0) return err("no-double", "You have no double moves left.");
      tickets.double--;
      next.doubleRemaining = 1;
    }
    const revealed = next.revealRounds.includes(next.round) && next.doubleRemaining === 0;
    next.log.push({
      round: next.round,
      transport,
      node: revealed ? to : null,
      double: Boolean(double)
    });
    events.push({
      type: "fugitive-move",
      seat,
      // Everyone learns how they travelled; only the fugitive learns where to.
      text:
        transport === "black"
          ? "The fugitive moves — no ticket was shown."
          : `The fugitive travels by ${transport}.`,
      data: { transport },
      sfx: "swoosh"
    });
    if (revealed) {
      events.push({
        type: "sighting",
        text: `Sighting: the fugitive is at ${to}.`,
        data: { node: to },
        sfx: "reveal"
      });
    }
    // The fugitive's own move gets a private line with the node in it.
    events.push({
      type: "fugitive-position",
      seat,
      text: `You move to ${to}.`,
      data: { node: to },
      visibleTo: [seat]
    });
  } else {
    events.push({
      type: "detective-move",
      seat,
      text: `${next.names[seat]} takes a ${transport} to ${to}.`,
      data: { node: to, transport },
      sfx: "pieceSet"
    });
    if (to === next.positions[next.fugitive]) {
      next.finished = true;
      next.winner = "detectives";
      events.push({
        type: "caught",
        seat,
        text: `${next.names[seat]} has the fugitive at ${to}.`,
        sfx: "win"
      });
      return ok({ state: next, events });
    }
  }

  advance(next, events);
  return ok({ state: next, events });
}

/** Move the baton on: fugitive, then each detective, then the next round. */
function advance(state: PhantomState, events: GameEvent[]): void {
  if (state.finished) return;

  if (state.toMove === state.fugitive && state.doubleRemaining > 0) {
    state.doubleRemaining--;
    return; // the fugitive moves again
  }

  const order = [state.fugitive, ...state.detectives];
  const index = order.indexOf(state.toMove);
  const nextIndex = index + 1;

  if (nextIndex < order.length) {
    state.toMove = order[nextIndex]!;
    // A detective with no legal move is skipped rather than stalling the round.
    return;
  }

  // Round complete.
  if (everyDetectiveStuck(state)) {
    state.finished = true;
    state.winner = "fugitive";
    events.push({
      type: "escaped",
      text: "Every detective is out of tickets — the fugitive walks away.",
      sfx: "lose"
    });
    return;
  }

  if (state.round >= state.finalRound) {
    state.finished = true;
    state.winner = "fugitive";
    events.push({
      type: "escaped",
      text: `Round ${state.finalRound} is over. The fugitive is gone.`,
      data: { node: state.positions[state.fugitive] },
      sfx: "lose"
    });
    return;
  }

  state.round++;
  state.toMove = state.fugitive;
  events.push({ type: "round", text: `Round ${state.round}.` });
}

function everyDetectiveStuck(state: PhantomState): boolean {
  return state.detectives.every((seat) => {
    const tickets = state.tickets[seat]!;
    return (
      exitsFrom(state.positions[seat]!).every((exit) => {
        if (exit.transport === "river") return true;
        return tickets[exit.transport] <= 0;
      }) || tickets.cab + tickets.tram + tickets.metro === 0
    );
  });
}

export function isTerminal(state: PhantomState): boolean {
  return state.finished;
}

export function score(state: PhantomState): FinalScore[] {
  const detectivesWon = state.winner === "detectives";
  const entries = Object.keys(state.positions)
    .map(Number)
    .map((seat) => {
      const fugitive = isFugitive(state, seat);
      const won = fugitive ? !detectivesWon : detectivesWon;
      return {
        seat,
        total: won ? 1 : 0,
        lines: [
          { label: fugitive ? "Fugitive" : "Detective", value: won ? 1 : 0 },
          { label: "Rounds survived", value: state.round }
        ]
      };
    });
  const ranked = rankScores(entries);
  for (const r of ranked) r.won = r.total === 1;
  return ranked;
}

/* -------------------------------------------------------------- redaction */

export interface PhantomView {
  /** Every node's coordinates come from the shared city module, not from here. */
  positions: Record<SeatId, number | null>;
  tickets: Record<SeatId, Tickets>;
  log: LogEntry[];
  round: number;
  toMove: SeatId;
  finalRound: number;
  revealRounds: number[];
  names: Record<SeatId, string>;
  fugitiveSeat: SeatId | null;
  amFugitive: boolean;
  /** Where the fugitive was last seen — the only place the detectives know. */
  lastSighting: { round: number; node: number } | null;
  winner: "fugitive" | "detectives" | null;
  finished: boolean;
  seat: SeatId | "spectator";
  doubleRemaining: number;
}

export function redactStateFor(state: PhantomState, viewer: SeatId | "spectator"): PhantomView {
  const amFugitive = viewer !== "spectator" && isFugitive(state, viewer);
  const positions: Record<SeatId, number | null> = {};

  for (const seat of Object.keys(state.positions).map(Number)) {
    if (seat === state.fugitive) {
      // The whole game: this line, and nothing else that touches it.
      const seen = state.log.filter((l) => l.node !== null).at(-1)?.node ?? null;
      positions[seat] = amFugitive || state.finished ? state.positions[seat]! : seen;
    } else {
      positions[seat] = state.positions[seat]!;
    }
  }

  const lastSighting = (() => {
    for (let i = state.log.length - 1; i >= 0; i--) {
      const entry = state.log[i]!;
      if (entry.node !== null) return { round: entry.round, node: entry.node };
    }
    return null;
  })();

  return {
    positions,
    // Ticket counts are public in this game — they are the clock everyone reads.
    tickets: clone(state.tickets),
    log: state.log.map((l) => ({ ...l })),
    round: state.round,
    toMove: state.toMove,
    finalRound: state.finalRound,
    revealRounds: state.revealRounds.slice(),
    names: { ...state.names },
    // Who the fugitive is, is public; where they are, is not.
    fugitiveSeat: state.fugitive,
    amFugitive,
    lastSighting,
    winner: state.winner,
    finished: state.finished,
    seat: viewer,
    doubleRemaining: state.doubleRemaining
  };
}

export function describeMove(_state: PhantomState, _seat: SeatId, move: PhantomMove): string {
  if (move.kind === "stuck") return "cannot move";
  return `travels by ${move.transport}`;
}

/** Tickets are conserved; nobody stands on anybody. */
export function invariants(state: PhantomState): string | void {
  const nodes = state.detectives.map((d) => state.positions[d]!);
  if (new Set(nodes).size !== nodes.length) return "two detectives share a node";
  for (const seat of Object.keys(state.tickets).map(Number)) {
    const t = state.tickets[seat]!;
    for (const kind of ["cab", "tram", "metro", "black", "double"] as const) {
      if (t[kind] < 0) return `seat ${seat} has negative ${kind} tickets`;
    }
  }
  if (!state.finished && state.round > state.finalRound) return "the game ran past its last round";
  return undefined;
}
