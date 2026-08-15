/** Chess as a Gambit game: state, moves, clocks, results. */
import {
  err,
  ok,
  type BaseState,
  type FinalScore,
  type GameEvent,
  type Result,
  type Seat,
  type SeatId
} from "@gambit/sdk";
import { z } from "zod";
import {
  START_FEN,
  applyMove as applyToPosition,
  colorOf,
  findMove,
  hasMatingMaterial,
  inCheck,
  legalMoves as legalPositionMoves,
  outcome,
  parseFen,
  repetitionKey,
  squareName,
  toFen,
  typeOf,
  type Color,
  type MoveInfo,
  type Position
} from "./rules";
import { toPgn, toSan } from "./san";

export const CLOCK_PRESETS = {
  "3+2": { minutes: 3, incrementSec: 2, label: "Blitz · 3+2" },
  "10+0": { minutes: 10, incrementSec: 0, label: "Rapid · 10+0" },
  "15+10": { minutes: 15, incrementSec: 10, label: "Classical · 15+10" },
  none: { minutes: 0, incrementSec: 0, label: "No clock" }
} as const;

export const configSchema = z.object({
  clock: z.enum(["3+2", "10+0", "15+10", "none"]).default("10+0"),
  /** Seat 0 plays White unless the host flips it. */
  seat0Color: z.enum(["w", "b"]).default("w")
});

export type ChessConfig = z.infer<typeof configSchema>;

export type ChessMove =
  | {
      kind: "move";
      from: number;
      to: number;
      promo?: "q" | "r" | "b" | "n";
      /** Offered with the move, the way it's done over a real board. */
      offerDraw?: boolean;
      __at?: number;
    }
  | { kind: "resign"; __at?: number }
  | { kind: "accept-draw"; __at?: number }
  | { kind: "decline-draw"; __at?: number };

export interface ChessResult {
  kind: "checkmate" | "resign" | "timeout" | "stalemate" | "fifty" | "threefold" | "material" | "agreement";
  winner: Color | null;
  text: string;
}

export interface ChessState extends BaseState {
  pos: Position;
  /** Seat → colour. Seat 0 is White by default. */
  colors: Record<SeatId, Color>;
  history: { san: string; from: number; to: number; promo?: string; fen: string; clock: number }[];
  /** Repetition counts by position key. */
  reps: Record<string, number>;
  clock: {
    enabled: boolean;
    /** Milliseconds left. */
    w: number;
    b: number;
    incrementMs: number;
    /** Server timestamp of the last move; null before the first. */
    lastAt: number | null;
  };
  drawOffer: Color | null;
  result: ChessResult | null;
  names: Record<SeatId, string>;
}

export function createState(config: ChessConfig, seats: Seat[], seed: string): ChessState {
  const preset = CLOCK_PRESETS[config.clock];
  const seat0: Color = config.seat0Color;
  const colors: Record<SeatId, Color> = {};
  const names: Record<SeatId, string> = {};
  seats.forEach((s, i) => {
    colors[s.id] = i === 0 ? seat0 : seat0 === "w" ? "b" : "w";
    names[s.id] = s.name;
  });
  const pos = parseFen(START_FEN);
  return {
    rng: { seed, cursor: 0 },
    seatCount: seats.length,
    ply: 0,
    pending: [],
    pos,
    colors,
    names,
    history: [],
    reps: { [repetitionKey(pos)]: 1 },
    clock: {
      enabled: preset.minutes > 0,
      w: preset.minutes * 60_000,
      b: preset.minutes * 60_000,
      incrementMs: preset.incrementSec * 1000,
      lastAt: null
    },
    drawOffer: null,
    result: null
  };
}

export const seatOfColor = (state: ChessState, color: Color): SeatId =>
  Number(Object.keys(state.colors).find((k) => state.colors[Number(k)] === color) ?? 0);

export function currentSeats(state: ChessState): SeatId[] {
  if (state.result) return [];
  return [seatOfColor(state, state.pos.turn)];
}

export function legalMoves(state: ChessState, seat: SeatId): ChessMove[] {
  if (state.result) return [];
  const color = state.colors[seat];
  if (!color) return [];

  if (state.pos.turn !== color) return [];

  const moves: ChessMove[] = legalPositionMoves(state.pos).map((m) => ({
    kind: "move" as const,
    from: m.from,
    to: m.to,
    ...(m.promo ? { promo: m.promo } : {})
  }));
  moves.push({ kind: "resign" });

  // An offer made with the opponent's last move is answered on your turn —
  // or simply declined by playing on, exactly as over a board.
  if (state.drawOffer && state.drawOffer !== color) {
    moves.push({ kind: "accept-draw" }, { kind: "decline-draw" });
  }
  return moves;
}

export function applyMove(
  state: ChessState,
  seat: SeatId,
  move: ChessMove
): Result<{ state: ChessState; events: GameEvent[] }> {
  if (state.result) return err("finished", "This game is already over.");
  const color = state.colors[seat];
  if (!color) return err("no-seat", "You aren't playing in this game.");
  const kind = (move as { kind?: string })?.kind;

  if (kind === "resign") {
    const winner: Color = color === "w" ? "b" : "w";
    const next: ChessState = {
      ...state,
      ply: state.ply + 1,
      result: {
        kind: "resign",
        winner,
        text: `${state.names[seat] ?? color} resigned.`
      }
    };
    return ok({
      state: next,
      events: [
        { type: "resign", seat, text: `${state.names[seat] ?? "A player"} resigns.`, sfx: "lose" }
      ]
    });
  }

  if (kind === "accept-draw") {
    if (!state.drawOffer || state.drawOffer === color) {
      return err("no-offer", "There's no draw offer to accept.");
    }
    return ok({
      state: {
        ...state,
        ply: state.ply + 1,
        drawOffer: null,
        result: { kind: "agreement", winner: null, text: "Draw agreed." }
      },
      events: [{ type: "draw", seat, text: "Draw agreed.", sfx: "score" }]
    });
  }

  if (kind === "decline-draw") {
    if (!state.drawOffer || state.drawOffer === color) {
      return err("no-offer", "There's no draw offer to decline.");
    }
    return ok({
      state: { ...state, ply: state.ply + 1, drawOffer: null },
      events: [{ type: "draw-declined", seat, text: "Draw declined." }]
    });
  }

  if (kind !== "move") return err("unknown-move", "That isn't a move this game understands.");

  if (state.pos.turn !== color) return err("not-your-turn", "It's not your move yet.");

  const m = move as Extract<ChessMove, { kind: "move" }>;
  const info = findMove(state.pos, { from: m.from, to: m.to, promo: m.promo });
  if (!info) {
    return err(
      "illegal",
      illegalReason(state.pos, m.from, m.to, color)
    );
  }

  const san = toSan(state.pos, info);
  const nextPos = applyToPosition(state.pos, info);
  const key = repetitionKey(nextPos);
  const reps = { ...state.reps, [key]: (state.reps[key] ?? 0) + 1 };

  // Clock: the mover pays for the time they took, then banks the increment.
  const clock = { ...state.clock };
  let flagged = false;
  if (clock.enabled) {
    const at = m.__at ?? clock.lastAt ?? 0;
    if (clock.lastAt !== null && at > clock.lastAt) {
      const spent = at - clock.lastAt;
      clock[color] = clock[color] - spent;
      if (clock[color] <= 0) {
        clock[color] = 0;
        flagged = true;
      }
    }
    if (!flagged) clock[color] = clock[color] + clock.incrementMs;
    if (m.__at) clock.lastAt = m.__at;
    else if (clock.lastAt === null) clock.lastAt = 0;
  }

  const events: GameEvent[] = [
    {
      type: info.captured ? "capture" : "move",
      seat,
      text: `${state.names[seat] ?? color}: ${san}`,
      data: { from: info.from, to: info.to, san, piece: info.piece, captured: info.captured ?? null },
      sfx: info.captured ? "capture" : "pieceSet"
    }
  ];
  if (m.offerDraw) {
    events.push({
      type: "draw-offer",
      seat,
      text: `${state.names[seat] ?? "A player"} offers a draw.`,
      sfx: "nudge"
    });
  }

  let result: ChessResult | null = null;

  if (flagged) {
    // Flag fall is only a loss if the opponent could actually mate you.
    const opponent: Color = color === "w" ? "b" : "w";
    const canMate = hasMatingMaterial(nextPos, opponent);
    result = canMate
      ? { kind: "timeout", winner: opponent, text: `${state.names[seat] ?? color} ran out of time.` }
      : {
          kind: "timeout",
          winner: null,
          text: "Time ran out, but no mating material — draw."
        };
    events.push({ type: "timeout", seat, text: result.text, sfx: canMate ? "lose" : "score" });
  } else {
    const out = outcome(nextPos, reps[key] ?? 1);
    if (out.over) {
      result =
        out.kind === "checkmate"
          ? {
              kind: "checkmate",
              winner: out.winner,
              text: `Checkmate — ${state.names[seatOfColor(state, out.winner)] ?? out.winner} wins.`
            }
          : {
              kind: out.kind,
              winner: null,
              text:
                out.kind === "stalemate"
                  ? "Stalemate — draw."
                  : out.kind === "fifty"
                    ? "Fifty moves without a pawn move or capture — draw."
                    : out.kind === "threefold"
                      ? "Threefold repetition — draw."
                      : "Insufficient material — draw."
            };
      events.push({
        type: out.kind === "checkmate" ? "checkmate" : "draw",
        seat,
        text: result.text,
        sfx: out.kind === "checkmate" ? "win" : "score"
      });
    } else if (inCheck(nextPos, nextPos.turn)) {
      events.push({ type: "check", seat, text: "Check.", sfx: "nudge" });
    }
  }

  const next: ChessState = {
    ...state,
    ply: state.ply + 1,
    pos: nextPos,
    reps,
    clock,
    // Playing on declines whatever was offered; a new offer rides along.
    drawOffer: m.offerDraw ? color : null,
    result,
    history: [
      ...state.history,
      {
        san,
        from: info.from,
        to: info.to,
        ...(info.promo ? { promo: info.promo } : {}),
        fen: toFen(nextPos),
        clock: clock[color]
      }
    ]
  };

  return ok({ state: next, events });
}

/** One line, in the player's language, for why that tap didn't work. */
function illegalReason(pos: Position, from: number, to: number, color: Color): string {
  const piece = pos.board[from];
  if (!piece) return "There's no piece on that square.";
  if (colorOf(piece) !== color) return "That's not your piece.";
  const target = pos.board[to];
  if (target && colorOf(target) === color) return "Your own piece is already there.";

  // Would it be legal but for the king? Then say so — it's the most common miss.
  const pseudo = legalPositionMoves(pos, color);
  const anyFrom = pseudo.some((m) => m.from === from);
  if (!anyFrom && inCheck(pos, color)) return "You're in check — deal with that first.";
  if (!anyFrom) return "Moving that piece would leave your king in check.";
  return `A ${nameOf(piece)} can't reach ${squareName(to)} from there.`;
}

function nameOf(piece: string): string {
  return (
    { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[typeOf(piece)] ?? "piece"
  );
}

export function isTerminal(state: ChessState): boolean {
  return state.result !== null;
}

export function score(state: ChessState): FinalScore[] {
  const seats = Object.keys(state.colors).map(Number);
  const winner = state.result?.winner ?? null;
  return seats
    .map((seat) => {
      const color = state.colors[seat]!;
      const point = winner === null ? 0.5 : winner === color ? 1 : 0;
      return {
        seat,
        total: point,
        lines: [
          { label: color === "w" ? "White" : "Black", value: point },
          { label: state.result?.kind ?? "result", value: 0 }
        ],
        rank: winner === null ? 1 : winner === color ? 1 : 2,
        won: winner !== null && winner === color
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

/**
 * Chess has no hidden information — but the view is still built here, never
 * handed out by reference, so the platform's one-way door stays one-way.
 */
export interface ChessView {
  fen: string;
  board: string[];
  turn: Color;
  colors: Record<SeatId, Color>;
  names: Record<SeatId, string>;
  history: ChessState["history"];
  clock: ChessState["clock"];
  drawOffer: Color | null;
  result: ChessResult | null;
  check: boolean;
  ply: number;
  lastMove: { from: number; to: number } | null;
}

export function redactStateFor(state: ChessState): ChessView {
  const last = state.history.at(-1);
  return {
    fen: toFen(state.pos),
    board: state.pos.board.slice(),
    turn: state.pos.turn,
    colors: { ...state.colors },
    names: { ...state.names },
    history: state.history.map((h) => ({ ...h })),
    clock: { ...state.clock },
    drawOffer: state.drawOffer,
    result: state.result ? { ...state.result } : null,
    check: inCheck(state.pos, state.pos.turn),
    ply: state.ply,
    lastMove: last ? { from: last.from, to: last.to } : null
  };
}

/** The view is a position, so the client can run the real rules on it. */
export function predict(view: ChessView, seat: SeatId, move: ChessMove): ChessView {
  if (move.kind !== "move") return view;
  const pos = parseFen(view.fen);
  const info = findMove(pos, { from: move.from, to: move.to, promo: move.promo });
  if (!info) return view;
  const next = applyToPosition(pos, info);
  return {
    ...view,
    fen: toFen(next),
    board: next.board.slice(),
    turn: next.turn,
    check: inCheck(next, next.turn),
    lastMove: { from: info.from, to: info.to },
    ply: view.ply + 1
  };
}

export function exportPgn(state: ChessState): string {
  const whiteSeat = seatOfColor(state, "w");
  const blackSeat = seatOfColor(state, "b");
  const result =
    state.result === null
      ? "*"
      : state.result.winner === "w"
        ? "1-0"
        : state.result.winner === "b"
          ? "0-1"
          : "1/2-1/2";
  return toPgn({
    white: state.names[whiteSeat] ?? "White",
    black: state.names[blackSeat] ?? "Black",
    san: state.history.map((h) => h.san),
    result
  });
}

export function describeMove(state: ChessState, seat: SeatId, move: ChessMove): string {
  if (move.kind !== "move") return move.kind.replace("-", " ");
  return state.history.at(-1)?.san ?? `${squareName(move.from)}${squareName(move.to)}`;
}

/** Conservation check for the test kit: pieces never appear from nowhere. */
export function invariants(state: ChessState): string | void {
  const counts: Record<string, number> = {};
  for (const p of state.pos.board) if (p) counts[p] = (counts[p] ?? 0) + 1;
  if ((counts["K"] ?? 0) !== 1) return "White must have exactly one king";
  if ((counts["k"] ?? 0) !== 1) return "Black must have exactly one king";
  for (const [piece, n] of Object.entries(counts)) {
    if (typeOf(piece) === "p" && n > 8) return `too many ${piece} pawns (${n})`;
  }
  const total = state.pos.board.filter(Boolean).length;
  if (total > 32) return `board holds ${total} pieces`;
  return undefined;
}

export type { MoveInfo, Position };
