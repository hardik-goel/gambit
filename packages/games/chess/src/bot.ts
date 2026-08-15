/**
 * The chess bot: alpha-beta minimax with piece-square tables and a capture-only
 * quiescence search, so it doesn't hang pieces at the horizon.
 *
 * Level 1 plays depth 2 with a dash of noise — a beatable club opponent.
 * Level 2 plays depth 3. Level 3 plays depth 4 and takes the position seriously.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import {
  applyMove,
  colorOf,
  inCheck,
  legalMoves,
  parseFen,
  typeOf,
  type Color,
  type MoveInfo,
  type Position
} from "./rules";
import type { ChessMove, ChessView } from "./state";

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/* Piece-square tables, White's point of view, index 0 = a8. */
const PST: Record<string, number[]> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ],
  r: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0, 20, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
  ],
  /** Kings behave differently once the queens come off. */
  kEnd: [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50
  ]
};

const mirror = (sq: number): number => (7 - Math.floor(sq / 8)) * 8 + (sq % 8);

/** Centipawn evaluation from White's point of view. */
export function evaluate(pos: Position): number {
  let score = 0;
  let material = 0;
  for (const p of pos.board) if (p && typeOf(p) !== "k" && typeOf(p) !== "p") material += VALUE[typeOf(p)]!;
  const endgame = material < 1400;

  for (let sq = 0; sq < 64; sq++) {
    const piece = pos.board[sq];
    if (!piece) continue;
    const t = typeOf(piece);
    const white = colorOf(piece) === "w";
    const table = t === "k" && endgame ? PST["kEnd"]! : PST[t]!;
    const value = VALUE[t]! + table[white ? sq : mirror(sq)]!;
    score += white ? value : -value;
  }
  return score;
}

interface SearchCtx {
  nodes: number;
  limit: number;
}

function quiesce(pos: Position, alpha: number, beta: number, side: number, ctx: SearchCtx): number {
  const stand = evaluate(pos) * side;
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (ctx.nodes++ > ctx.limit) return alpha;

  const captures = legalMoves(pos).filter((m) => m.captured || m.promo);
  captures.sort(mvvLva);
  for (const m of captures) {
    const score = -quiesce(applyMove(pos, m), -beta, -alpha, -side, ctx);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(
  pos: Position,
  depth: number,
  alpha: number,
  beta: number,
  side: number,
  ctx: SearchCtx
): number {
  if (ctx.nodes++ > ctx.limit) return evaluate(pos) * side;
  const moves = legalMoves(pos);
  if (moves.length === 0) {
    // Mate scores are depth-adjusted so the bot prefers the faster mate.
    return inCheck(pos) ? -100000 - depth : 0;
  }
  if (depth === 0) return quiesce(pos, alpha, beta, side, ctx);

  moves.sort(mvvLva);
  let best = -Infinity;
  for (const m of moves) {
    const score = -negamax(applyMove(pos, m), depth - 1, -beta, -alpha, -side, ctx);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Most-valuable-victim / least-valuable-attacker ordering. */
function mvvLva(a: MoveInfo, b: MoveInfo): number {
  const gain = (m: MoveInfo) =>
    (m.captured ? VALUE[typeOf(m.captured)]! : 0) - VALUE[typeOf(m.piece)]! / 10 + (m.promo ? 800 : 0);
  return gain(b) - gain(a);
}

export function bot(view: ChessView, legal: ChessMove[], rng: Rng, level: BotLevel): ChessMove {
  const playable = legal.filter((m): m is Extract<ChessMove, { kind: "move" }> => m.kind === "move");
  if (playable.length === 0) {
    // Only non-moves left: take a draw over nothing.
    return legal.find((m) => m.kind === "accept-draw") ?? legal[0]!;
  }

  const pos = parseFen(view.fen);
  const side: number = pos.turn === "w" ? 1 : -1;
  const depth = level === 1 ? 2 : level === 2 ? 3 : 4;
  // Node ceilings keep a level-1 table instant and a level-3 table honest;
  // they also make five hundred bot-versus-bot simulations finish in minutes.
  const ctx: SearchCtx = { nodes: 0, limit: level === 1 ? 6_000 : level === 2 ? 90_000 : 400_000 };

  const infos = legalMoves(pos);
  infos.sort(mvvLva);

  let bestScore = -Infinity;
  let best: MoveInfo[] = [];
  let alpha = -Infinity;
  for (const m of infos) {
    const score = -negamax(applyMove(pos, m), depth - 1, -Infinity, -alpha, -side, ctx);
    // Level 1 wobbles by up to a third of a pawn — human enough to be fun.
    const noise = level === 1 ? (rng.raw() - 0.5) * 70 : level === 2 ? (rng.raw() - 0.5) * 12 : 0;
    const adjusted = score + noise;
    if (adjusted > bestScore + 0.001) {
      bestScore = adjusted;
      best = [m];
      alpha = Math.max(alpha, score);
    } else if (Math.abs(adjusted - bestScore) <= 0.001) {
      best.push(m);
    }
  }

  const chosen = best.length ? rng.pick(best) : rng.pick(infos);
  const match = playable.find(
    (m) => m.from === chosen.from && m.to === chosen.to && (m.promo ?? "q") === (chosen.promo ?? "q")
  );
  return (
    match ?? {
      kind: "move",
      from: chosen.from,
      to: chosen.to,
      ...(chosen.promo ? { promo: chosen.promo } : {})
    }
  );
}

export type { Color };
