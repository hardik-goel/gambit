/**
 * Motive — someone at this table did it.
 *
 * The interesting machinery is the disprove step: a suggestion asks the players
 * clockwise, in order, and the first one holding any named card must privately
 * show exactly one. Everybody sees *that* a card was shown; only the suggester
 * sees *which*. That runs on the platform's pending-input stack and its
 * per-event `visibleTo`, with no game-specific plumbing anywhere else.
 */
import {
  clockwiseFrom,
  clone,
  err,
  ok,
  pendingId,
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
  CARDS,
  IMPLEMENTS,
  ROOMS,
  SECRET_PASSAGES,
  START_POSITIONS,
  SUSPECTS,
  cardById,
  implementCard,
  reachable,
  roomCard,
  samePosition,
  suspectCard,
  type Position
} from "./mansion";

export const configSchema = z.object({
  /** A shorter game deals the leftovers face up; the long game hides them. */
  leftovers: z.enum(["face-up", "hidden"]).default("face-up")
});

export type MotiveConfig = z.infer<typeof configSchema>;

export type MotiveMove =
  | { kind: "move"; to: Position }
  | { kind: "passage" }
  | { kind: "stay" }
  | { kind: "suggest"; suspect: number; implement: number }
  | { kind: "show"; card: string }
  | { kind: "accuse"; suspect: number; implement: number; room: number }
  | { kind: "end-turn" };

export interface Suggestion {
  by: SeatId;
  suspect: number;
  implement: number;
  room: number;
  /** Seats still to be asked, in order. */
  queue: SeatId[];
}

/**
 * The public record of a suggestion: who asked, what they named, who could not
 * answer, and who finally did. Everyone hears all of this at a real table, and
 * it is the raw material of every deduction in the game.
 */
export interface SuggestionRecord {
  by: SeatId;
  suspect: number;
  implement: number;
  room: number;
  passed: SeatId[];
  shownBy: SeatId | null;
}

export interface MotiveState extends BaseState {
  caseFile: { suspect: number; implement: number; room: number };
  hands: Record<SeatId, string[]>;
  /** Cards nobody was dealt — public in the standard game. */
  leftovers: string[];
  leftoversPublic: boolean;
  /** Where each player's pawn is. */
  pawns: Record<SeatId, Position>;
  /** Where each suspect token stands — suggestions drag them about. */
  suspects: Record<number, Position>;
  implements: Record<number, number>;
  /** Cards shown to each seat, and by whom. */
  seen: Record<SeatId, { card: string; from: SeatId }[]>;
  eliminated: SeatId[];
  names: Record<SeatId, string>;
  seatSuspect: Record<SeatId, number>;
  turn: SeatId;
  /** The roll for this turn, or null once it has been spent. */
  roll: number | null;
  /** Set when a suggestion moved you here: you may suggest without rolling. */
  summoned: SeatId[];
  moved: boolean;
  suggested: boolean;
  suggestion: Suggestion | null;
  history: SuggestionRecord[];
  /** Rounds played; the night is not infinite. */
  round: number;
  maxRounds: number;
  winner: SeatId | null;
  finished: boolean;
}

export function createState(config: MotiveConfig, seats: Seat[], seed: string): MotiveState {
  const rng = new Rng(seed);
  const caseFile = {
    suspect: rng.int(SUSPECTS.length),
    implement: rng.int(IMPLEMENTS.length),
    room: rng.int(ROOMS.length)
  };

  const rest = rng.shuffle(
    CARDS.filter(
      (c) =>
        !(c.kind === "suspect" && c.index === caseFile.suspect) &&
        !(c.kind === "implement" && c.index === caseFile.implement) &&
        !(c.kind === "room" && c.index === caseFile.room)
    ).map((c) => c.id)
  );

  const hands: Record<SeatId, string[]> = {};
  const seen: Record<SeatId, { card: string; from: SeatId }[]> = {};
  const names: Record<SeatId, string> = {};
  const pawns: Record<SeatId, Position> = {};
  const seatSuspect: Record<SeatId, number> = {};

  const per = Math.floor(rest.length / seats.length);
  seats.forEach((seat, i) => {
    hands[seat.id] = rest.slice(i * per, (i + 1) * per);
    seen[seat.id] = [];
    names[seat.id] = seat.name;
    pawns[seat.id] = START_POSITIONS[i % START_POSITIONS.length]!;
    seatSuspect[seat.id] = i % SUSPECTS.length;
  });
  const leftovers = rest.slice(per * seats.length);

  // Suspect tokens stand where their player does; the unplayed ones wait in
  // the rooms, which is where a suggestion will find them.
  const suspects: Record<number, Position> = {};
  for (let i = 0; i < SUSPECTS.length; i++) {
    const seat = seats.find((s) => seatSuspect[s.id] === i);
    suspects[i] = seat ? pawns[seat.id]! : { kind: "room", room: i % ROOMS.length };
  }
  const implementsIn: Record<number, number> = {};
  const rooms = rng.shuffle(ROOMS.map((_, i) => i));
  IMPLEMENTS.forEach((_, i) => {
    implementsIn[i] = rooms[i % rooms.length]!;
  });

  const state: MotiveState = {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    caseFile,
    hands,
    leftovers,
    leftoversPublic: config.leftovers === "face-up",
    pawns,
    suspects,
    implements: implementsIn,
    seen,
    eliminated: [],
    names,
    seatSuspect,
    turn: seats[0]!.id,
    roll: null,
    summoned: [],
    moved: false,
    suggested: false,
    suggestion: null,
    history: [],
    round: 1,
    maxRounds: 40,
    winner: null,
    finished: false
  };
  rollFor(state);
  return state;
}

/** Two dice, from the server's stream. Clients never roll. */
function rollFor(state: MotiveState): void {
  const rng = Rng.from(state.rng);
  state.roll = rng.die() + rng.die();
  state.rng = rng.serialize();
}

export function currentSeats(state: MotiveState): SeatId[] {
  if (state.finished) return [];
  if (state.pending.length) return [state.pending.at(-1)!.seat];
  return [state.turn];
}

const occupiedCells = (state: MotiveState, except: SeatId): { x: number; y: number }[] =>
  Object.entries(state.pawns)
    .filter(([seat]) => Number(seat) !== except)
    .map(([, position]) => position)
    .filter((p): p is { kind: "cell"; x: number; y: number } => p.kind === "cell")
    .map((p) => ({ x: p.x, y: p.y }));

export function legalMoves(state: MotiveState, seat: SeatId): MotiveMove[] {
  if (state.finished) return [];

  const open = state.pending.at(-1);
  if (open) {
    if (open.seat !== seat) return [];
    if (open.kind === "disprove") {
      const held = (open.data?.cards as string[]) ?? [];
      return held.map((card) => ({ kind: "show" as const, card }));
    }
    return [];
  }

  if (state.turn !== seat) return [];
  const moves: MotiveMove[] = [];
  const here = state.pawns[seat]!;
  const eliminated = state.eliminated.includes(seat);

  if (!state.moved && !eliminated) {
    if (state.roll !== null) {
      for (const target of reachable(here, state.roll, occupiedCells(state, seat))) {
        moves.push({ kind: "move", to: target });
      }
    }
    // Dragged in here by somebody else's suggestion? Then you may stand still
    // and make your own from the same room.
    if (here.kind === "room" && state.summoned.includes(seat)) moves.push({ kind: "stay" });
    if (here.kind === "room" && SECRET_PASSAGES[here.room] !== undefined) {
      moves.push({ kind: "passage" });
    }
  }

  if (!eliminated && state.moved && !state.suggested && state.pawns[seat]!.kind === "room") {
    const room = (state.pawns[seat]! as { kind: "room"; room: number }).room;
    for (let suspect = 0; suspect < SUSPECTS.length; suspect++) {
      for (let implement = 0; implement < IMPLEMENTS.length; implement++) {
        moves.push({ kind: "suggest", suspect, implement });
      }
    }
    void room;
  }

  if (!eliminated) {
    // One accusation, ever, at the end of a turn.
    //
    // Only combinations this seat has not already disproved are offered: those
    // are exactly the ones a player could sensibly name, and the set is built
    // from what this seat can see — its own cards, what it has been shown, and
    // the face-up leftovers — so offering it leaks nothing.
    const cleared = new Set([
      ...(state.hands[seat] ?? []),
      ...(state.seen[seat] ?? []).map((s) => s.card),
      ...(state.leftoversPublic ? state.leftovers : [])
    ]);
    for (let suspect = 0; suspect < SUSPECTS.length; suspect++) {
      if (cleared.has(suspectCard(suspect))) continue;
      for (let implement = 0; implement < IMPLEMENTS.length; implement++) {
        if (cleared.has(implementCard(implement))) continue;
        for (let room = 0; room < ROOMS.length; room++) {
          if (cleared.has(roomCard(room))) continue;
          moves.push({ kind: "accuse", suspect, implement, room });
        }
      }
    }
  }

  // You must move if you can; the turn ends after that.
  if (state.moved || eliminated || !moves.some((m) => m.kind === "move" || m.kind === "passage" || m.kind === "stay")) {
    moves.push({ kind: "end-turn" });
  }
  return moves;
}

export function applyMove(
  state: MotiveState,
  seat: SeatId,
  move: MotiveMove
): Result<{ state: MotiveState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  const kind = (move as { kind?: string })?.kind;
  const open = state.pending.at(-1);

  if (open) {
    if (open.seat !== seat) return err("not-your-turn", "Someone else is answering right now.");
    if (kind !== "show") return err("must-show", "You hold one of those cards — show one.");
  } else if (state.turn !== seat) {
    return err("not-your-turn", "Wait for your turn.");
  }

  const next = clone(state);
  const events: GameEvent[] = [];

  switch (kind) {
    case "move":
    case "passage":
    case "stay": {
      if (next.eliminated.includes(seat)) return err("eliminated", "You've already accused, and been wrong.");
      if (next.moved) return err("already-moved", "You've already moved this turn.");
      const here = next.pawns[seat]!;

      if (kind === "passage") {
        if (here.kind !== "room" || SECRET_PASSAGES[here.room] === undefined) {
          return err("no-passage", "There's no passage from here.");
        }
        const to = SECRET_PASSAGES[here.room]!;
        next.pawns[seat] = { kind: "room", room: to };
        next.suspects[next.seatSuspect[seat]!] = { kind: "room", room: to };
        events.push({
          type: "passage",
          seat,
          text: `${next.names[seat]} takes the passage to the ${ROOMS[to]}.`,
          sfx: "swoosh"
        });
      } else if (kind === "stay") {
        if (here.kind !== "room" || !next.summoned.includes(seat)) {
          return err("cannot-stay", "You have to move on your own turn.");
        }
        events.push({ type: "stay", seat, text: `${next.names[seat]} stays put.` });
      } else {
        const { to } = move as { to: Position };
        const options = reachable(here, next.roll ?? 0, occupiedCells(next, seat));
        if (!options.some((p) => samePosition(p, to))) {
          return err("too-far", `You rolled ${next.roll}; that's out of reach.`);
        }
        next.pawns[seat] = to;
        next.suspects[next.seatSuspect[seat]!] = to;
        events.push({
          type: "move",
          seat,
          text:
            to.kind === "room"
              ? `${next.names[seat]} enters the ${ROOMS[to.room]}.`
              : `${next.names[seat]} moves along the corridor.`,
          data: { to },
          sfx: "pieceSet"
        });
      }

      next.moved = true;
      next.summoned = next.summoned.filter((s) => s !== seat);
      next.ply++;
      return ok({ state: next, events });
    }

    case "suggest": {
      if (next.eliminated.includes(seat)) return err("eliminated", "You're out of the questioning.");
      if (!next.moved) return err("move-first", "Move before you suggest.");
      if (next.suggested) return err("already-suggested", "One suggestion a turn.");
      const here = next.pawns[seat]!;
      if (here.kind !== "room") return err("not-in-room", "You can only suggest inside a room.");
      const { suspect, implement } = move as { suspect: number; implement: number };
      if (suspect < 0 || suspect >= SUSPECTS.length) return err("no-suspect", "There's no such person.");
      if (implement < 0 || implement >= IMPLEMENTS.length) return err("no-implement", "There's no such thing.");

      const room = here.room;
      next.suggested = true;
      next.ply++;

      // The named suspect and implement are brought into the room — and if that
      // suspect is somebody's pawn, they are brought with it.
      next.suspects[suspect] = { kind: "room", room };
      next.implements[implement] = room;
      for (const [other, index] of Object.entries(next.seatSuspect)) {
        if (index === suspect && Number(other) !== seat) {
          next.pawns[Number(other)] = { kind: "room", room };
          if (!next.summoned.includes(Number(other))) next.summoned.push(Number(other));
        }
      }

      events.push({
        type: "suggest",
        seat,
        text: `${next.names[seat]} suggests ${SUSPECTS[suspect]}, in the ${ROOMS[room]}, with the ${IMPLEMENTS[implement]}.`,
        data: { suspect, implement, room },
        sfx: "nudge"
      });

      const queue = clockwiseFrom(seat, next.seatCount);
      next.suggestion = { by: seat, suspect, implement, room, queue };
      next.history.push({ by: seat, suspect, implement, room, passed: [], shownBy: null });
      askNext(next, events);
      return ok({ state: next, events });
    }

    case "show": {
      const suggestion = next.suggestion;
      if (!suggestion) return err("nothing-asked", "Nobody has asked you anything.");
      const { card } = move as { card: string };
      const hand = next.hands[seat] ?? [];
      if (!hand.includes(card)) return err("not-held", "You don't hold that card.");
      const named = [
        suspectCard(suggestion.suspect),
        implementCard(suggestion.implement),
        roomCard(suggestion.room)
      ];
      if (!named.includes(card)) return err("not-named", "That card wasn't part of the suggestion.");

      next.seen[suggestion.by] = [...(next.seen[suggestion.by] ?? []), { card, from: seat }];
      const record = next.history.at(-1);
      if (record) record.shownBy = seat;
      next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.suggestion = null;
      next.ply++;

      // Everyone learns that a card was shown; only the two of you learn which.
      events.push({
        type: "disproved",
        seat,
        text: `${next.names[seat]} shows ${next.names[suggestion.by]} a card.`,
        sfx: "cardSlip"
      });
      events.push({
        type: "disproved-private",
        seat,
        text: `${next.names[seat]} shows you the ${cardById(card).name}.`,
        data: { card, from: seat },
        visibleTo: [suggestion.by, seat]
      });
      return ok({ state: next, events });
    }

    case "accuse": {
      if (next.eliminated.includes(seat)) return err("eliminated", "You've had your accusation.");
      const { suspect, implement, room } = move as { suspect: number; implement: number; room: number };
      const right =
        suspect === next.caseFile.suspect &&
        implement === next.caseFile.implement &&
        room === next.caseFile.room;
      next.ply++;

      if (right) {
        next.finished = true;
        next.winner = seat;
        events.push({
          type: "solved",
          seat,
          text: `${next.names[seat]} accuses ${SUSPECTS[suspect]}, in the ${ROOMS[room]}, with the ${IMPLEMENTS[implement]} — and is right.`,
          data: { ...next.caseFile },
          sfx: "win"
        });
        return ok({ state: next, events });
      }

      next.eliminated.push(seat);
      events.push({
        type: "wrong",
        seat,
        text: `${next.names[seat]} accuses ${SUSPECTS[suspect]} — and is wrong. They play no further part, but must still answer.`,
        sfx: "lose"
      });

      if (next.eliminated.length >= next.seatCount) {
        next.finished = true;
        next.winner = null;
        events.push({
          type: "unsolved",
          text: "Everyone has accused and everyone was wrong. The case is closed unsolved.",
          data: { ...next.caseFile },
          sfx: "score"
        });
        return ok({ state: next, events });
      }
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    case "end-turn": {
      next.ply++;
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    default:
      return err("unknown-move", "That isn't a move this game understands.");
  }
}

/** Ask the next player in order; auto-pass anyone holding nothing. */
function askNext(state: MotiveState, events: GameEvent[]): void {
  const suggestion = state.suggestion;
  if (!suggestion) return;
  const named = [
    suspectCard(suggestion.suspect),
    implementCard(suggestion.implement),
    roomCard(suggestion.room)
  ];

  while (suggestion.queue.length) {
    const seat = suggestion.queue.shift()!;
    const held = (state.hands[seat] ?? []).filter((card) => named.includes(card));
    if (held.length === 0) {
      state.history.at(-1)?.passed.push(seat);
      events.push({
        type: "pass",
        seat,
        text: `${state.names[seat]} has nothing to show.`
      });
      continue;
    }
    state.pending.push({
      id: pendingId(state, "disprove", seat),
      seat,
      kind: "disprove",
      prompt: "You hold one of those. Show exactly one.",
      data: { cards: held }
    });
    return;
  }

  // Nobody could disprove it — which is the loudest thing that can happen here.
  events.push({
    type: "unchallenged",
    seat: suggestion.by,
    text: `Nobody can disprove ${state.names[suggestion.by]}'s suggestion.`,
    sfx: "reveal"
  });
  state.suggestion = null;
}

function endTurn(state: MotiveState, seat: SeatId, events: GameEvent[]): void {
  state.moved = false;
  state.suggested = false;
  state.suggestion = null;

  let next = seat;
  for (let i = 0; i < state.seatCount; i++) {
    next = (next + 1) % state.seatCount;
    // Eliminated players still hold cards and still answer, but take no turns.
    if (!state.eliminated.includes(next)) break;
  }
  if (next <= seat) state.round++;
  state.turn = next;

  // The night ends eventually. A case nobody could close stays open, and the
  // file is read out — otherwise an online table with cautious players would
  // never finish at all.
  if (state.round > state.maxRounds) {
    state.finished = true;
    state.winner = null;
    events.push({
      type: "unsolved",
      text: "Dawn comes and nobody has named it. The file is opened.",
      data: { ...state.caseFile },
      sfx: "score"
    });
    return;
  }

  rollFor(state);
  events.push({ type: "roll", seat: next, text: `${state.names[next]} rolls ${state.roll}.`, sfx: "diceTumble" });
}

export function isTerminal(state: MotiveState): boolean {
  return state.finished;
}

export function score(state: MotiveState): FinalScore[] {
  const entries = Object.keys(state.hands)
    .map(Number)
    .map((seat) => ({
      seat,
      total: seat === state.winner ? 100 : state.eliminated.includes(seat) ? 0 : 10,
      lines: [
        { label: seat === state.winner ? "Solved the case" : "Still guessing", value: seat === state.winner ? 1 : 0 },
        { label: "Cards seen", value: (state.seen[seat] ?? []).length }
      ]
    }));
  const ranked = rankScores(entries);
  for (const r of ranked) r.won = r.seat === state.winner;
  return ranked;
}

/* -------------------------------------------------------------- redaction */

export interface MotiveView {
  hand: string[];
  handCounts: Record<SeatId, number>;
  leftovers: string[];
  seen: { card: string; from: SeatId }[];
  pawns: Record<SeatId, Position>;
  suspects: Record<number, Position>;
  implements: Record<number, number>;
  eliminated: SeatId[];
  names: Record<SeatId, string>;
  seatSuspect: Record<SeatId, number>;
  turn: SeatId;
  roll: number | null;
  moved: boolean;
  suggested: boolean;
  summoned: SeatId[];
  /** The suggestion currently going round the table, if any. */
  suggestion: { by: SeatId; suspect: number; implement: number; room: number } | null;
  /** Public log of who could and could not disprove what. */
  history: SuggestionRecord[];
  round: number;
  maxRounds: number;
  winner: SeatId | null;
  finished: boolean;
  seat: SeatId | "spectator";
  pending: { kind: string; prompt?: string; cards?: string[] } | null;
  /** Everything this seat can prove is not in the case file. */
  cleared: string[];
  /** Revealed only once the game is over. */
  caseFile: { suspect: number; implement: number; room: number } | null;
}

export function redactStateFor(state: MotiveState, viewer: SeatId | "spectator"): MotiveView {
  const handCounts: Record<SeatId, number> = {};
  for (const [seat, hand] of Object.entries(state.hands)) handCounts[Number(seat)] = hand.length;

  const hand = viewer === "spectator" ? [] : (state.hands[viewer] ?? []);
  const seen = viewer === "spectator" ? [] : (state.seen[viewer] ?? []);
  const open = viewer === "spectator" ? undefined : state.pending.filter((p) => p.seat === viewer).at(-1);

  return {
    hand: hand.slice(),
    handCounts,
    leftovers: state.leftoversPublic ? state.leftovers.slice() : [],
    seen: seen.map((s) => ({ ...s })),
    pawns: clone(state.pawns),
    suspects: clone(state.suspects),
    implements: { ...state.implements },
    eliminated: state.eliminated.slice(),
    names: { ...state.names },
    seatSuspect: { ...state.seatSuspect },
    turn: state.turn,
    roll: state.roll,
    moved: state.moved,
    suggested: state.suggested,
    summoned: state.summoned.slice(),
    history: state.history.map((h) => ({ ...h, passed: h.passed.slice() })),
    round: state.round,
    maxRounds: state.maxRounds,
    suggestion: state.suggestion
      ? {
          by: state.suggestion.by,
          suspect: state.suggestion.suspect,
          implement: state.suggestion.implement,
          room: state.suggestion.room
        }
      : null,
    winner: state.winner,
    finished: state.finished,
    seat: viewer,
    pending: open ? { kind: open.kind, prompt: open.prompt, cards: open.data?.cards as string[] } : null,
    // The notepad's automatic marks: your own cards, whatever you have been
    // shown, and the face-up leftovers. Nothing that belongs to anyone else.
    cleared: [
      ...hand,
      ...seen.map((s) => s.card),
      ...(state.leftoversPublic ? state.leftovers : [])
    ],
    caseFile: state.finished ? { ...state.caseFile } : null
  };
}

export function describeMove(_state: MotiveState, _seat: SeatId, move: MotiveMove): string {
  switch (move.kind) {
    case "move": return "moves";
    case "passage": return "takes the secret passage";
    case "stay": return "stays put";
    case "suggest": return `suggests ${SUSPECTS[move.suspect]} with the ${IMPLEMENTS[move.implement]}`;
    case "show": return "shows a card";
    case "accuse": return "makes an accusation";
    default: return "ends the turn";
  }
}

/** Twenty-one cards exist: three in the file, the rest dealt or face up. */
export function invariants(state: MotiveState): string | void {
  const dealt = Object.values(state.hands).flat();
  const total = dealt.length + state.leftovers.length + 3;
  if (total !== CARDS.length) return `card count is ${total}, should be ${CARDS.length}`;
  if (new Set(dealt).size !== dealt.length) return "a card was dealt twice";
  const caseCards = [
    suspectCard(state.caseFile.suspect),
    implementCard(state.caseFile.implement),
    roomCard(state.caseFile.room)
  ];
  for (const card of caseCards) {
    if (dealt.includes(card) || state.leftovers.includes(card)) {
      return "a card in the case file was also dealt";
    }
  }
  const cells = Object.values(state.pawns).filter((p) => p.kind === "cell");
  const keys = cells.map((p) => `${(p as { x: number }).x},${(p as { y: number }).y}`);
  if (new Set(keys).size !== keys.length) return "two pawns share a corridor square";
  return undefined;
}

export { SUSPECTS, IMPLEMENTS, ROOMS };
