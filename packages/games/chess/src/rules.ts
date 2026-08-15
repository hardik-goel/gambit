/**
 * Chess rules — complete FIDE movement, castling, en passant, promotion,
 * check/checkmate/stalemate and every draw condition.
 *
 * Squares are 0..63 in FEN reading order: 0 = a8, 7 = h8, 56 = a1, 63 = h1.
 * Pieces are single characters, uppercase White, lowercase Black, "" empty —
 * compact enough that a whole position hashes to a short string, which is what
 * threefold repetition needs.
 */

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Position {
  board: string[];
  turn: Color;
  /** Subset of "KQkq" — rights, not availability. */
  castling: string;
  /** En-passant target square, or null. Set only the move after a double push. */
  ep: number | null;
  /** Halfmove clock for the fifty-move rule. */
  halfmove: number;
  fullmove: number;
}

export interface Move {
  from: number;
  to: number;
  promo?: "q" | "r" | "b" | "n";
}

export interface MoveInfo extends Move {
  piece: string;
  captured?: string;
  castle?: "K" | "Q";
  enPassant?: boolean;
  doublePush?: boolean;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const file = (sq: number): number => sq % 8;
export const rank = (sq: number): number => 7 - Math.floor(sq / 8); // 0 = rank 1
export const colorOf = (piece: string): Color => (piece === piece.toUpperCase() ? "w" : "b");
export const typeOf = (piece: string): PieceType => piece.toLowerCase() as PieceType;
export const onBoard = (sq: number): boolean => sq >= 0 && sq < 64;
export const squareName = (sq: number): string => "abcdefgh"[file(sq)]! + String(rank(sq) + 1);
export const squareIndex = (name: string): number => {
  const f = "abcdefgh".indexOf(name[0]!.toLowerCase());
  const r = Number(name[1]) - 1;
  return (7 - r) * 8 + f;
};

/* ------------------------------------------------------------------- FEN */

export function parseFen(fen: string): Position {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board: string[] = Array(64).fill("");
  let sq = 0;
  for (const ch of placement ?? "") {
    if (ch === "/") continue;
    if (/\d/.test(ch)) sq += Number(ch);
    else board[sq++] = ch;
  }
  return {
    board,
    turn: (turn === "b" ? "b" : "w") as Color,
    castling: castling && castling !== "-" ? castling : "",
    ep: ep && ep !== "-" ? squareIndex(ep) : null,
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1)
  };
}

export function toFen(pos: Position): string {
  let placement = "";
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 8 + f]!;
      if (p === "") empty++;
      else {
        if (empty) placement += empty;
        empty = 0;
        placement += p;
      }
    }
    if (empty) placement += empty;
    if (r < 7) placement += "/";
  }
  return [
    placement,
    pos.turn,
    pos.castling || "-",
    pos.ep === null ? "-" : squareName(pos.ep),
    pos.halfmove,
    pos.fullmove
  ].join(" ");
}

/** Repetition key: position + side to move + castling + ep rights, no clocks. */
export function repetitionKey(pos: Position): string {
  return `${pos.board.join("")}|${pos.turn}|${pos.castling}|${pos.ep ?? "-"}`;
}

/* ------------------------------------------------------------- generation */

const KNIGHT_DELTAS = [-17, -15, -10, -6, 6, 10, 15, 17];
const KING_DELTAS = [-9, -8, -7, -1, 1, 7, 8, 9];
const BISHOP_DIRS = [-9, -7, 7, 9];
const ROOK_DIRS = [-8, -1, 1, 8];

/** Steps that wrap around the board edge are not moves. */
function step(from: number, delta: number): number | null {
  const to = from + delta;
  if (!onBoard(to)) return null;
  const df = Math.abs(file(to) - file(from));
  // Any legal single step moves at most two files (knights); wraps move 6+.
  if (df > 2) return null;
  return to;
}

/** Pseudo-legal moves: correct piece movement, king safety not yet applied. */
export function pseudoLegalMoves(pos: Position, color: Color = pos.turn): MoveInfo[] {
  const out: MoveInfo[] = [];
  for (let from = 0; from < 64; from++) {
    const piece = pos.board[from]!;
    if (!piece || colorOf(piece) !== color) continue;
    const t = typeOf(piece);

    if (t === "p") {
      const dir = color === "w" ? -8 : 8;
      // Row index from the top: White's pawns start on row 6, Black's on row 1.
      const startRank = color === "w" ? 6 : 1;
      const one = from + dir;
      const promoRank = color === "w" ? 0 : 7;

      if (onBoard(one) && pos.board[one] === "") {
        pushPawn(out, { from, to: one, piece }, promoRank);
        const two = from + dir * 2;
        if (Math.floor(from / 8) === startRank && pos.board[two] === "") {
          out.push({ from, to: two, piece, doublePush: true });
        }
      }
      for (const d of [dir - 1, dir + 1]) {
        const to = step(from, d);
        if (to === null) continue;
        const target = pos.board[to]!;
        if (target && colorOf(target) !== color) {
          pushPawn(out, { from, to, piece, captured: target }, promoRank);
        } else if (target === "" && pos.ep === to) {
          const capSq = color === "w" ? to + 8 : to - 8;
          out.push({ from, to, piece, captured: pos.board[capSq]!, enPassant: true });
        }
      }
      continue;
    }

    if (t === "n" || t === "k") {
      const deltas = t === "n" ? KNIGHT_DELTAS : KING_DELTAS;
      for (const d of deltas) {
        const to = step(from, d);
        if (to === null) continue;
        const target = pos.board[to]!;
        if (target && colorOf(target) === color) continue;
        out.push({ from, to, piece, captured: target || undefined });
      }
      continue;
    }

    const dirs = t === "b" ? BISHOP_DIRS : t === "r" ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
    for (const d of dirs) {
      let cur = from;
      for (;;) {
        const to = step(cur, d);
        if (to === null) break;
        const target = pos.board[to]!;
        if (target === "") {
          out.push({ from, to, piece });
          cur = to;
          continue;
        }
        if (colorOf(target) !== color) out.push({ from, to, piece, captured: target });
        break;
      }
    }
  }

  addCastling(pos, color, out);
  return out;
}

function pushPawn(out: MoveInfo[], base: MoveInfo, promoRank: number): void {
  if (Math.floor(base.to / 8) === promoRank) {
    for (const promo of ["q", "r", "b", "n"] as const) out.push({ ...base, promo });
  } else {
    out.push(base);
  }
}

function addCastling(pos: Position, color: Color, out: MoveInfo[]): void {
  const king = color === "w" ? "K" : "k";
  const kingSq = pos.board.indexOf(king);
  if (kingSq === -1) return;
  const homeSq = color === "w" ? 60 : 4;
  if (kingSq !== homeSq) return;
  if (isAttacked(pos, kingSq, color === "w" ? "b" : "w")) return;

  const rights = color === "w" ? { K: "K", Q: "Q" } : { K: "k", Q: "q" };
  const enemy: Color = color === "w" ? "b" : "w";

  // King-side: f and g empty, e/f/g unattacked, rook home.
  if (pos.castling.includes(rights.K)) {
    const rookSq = homeSq + 3;
    const rook = color === "w" ? "R" : "r";
    if (
      pos.board[rookSq] === rook &&
      pos.board[homeSq + 1] === "" &&
      pos.board[homeSq + 2] === "" &&
      !isAttacked(pos, homeSq + 1, enemy) &&
      !isAttacked(pos, homeSq + 2, enemy)
    ) {
      out.push({ from: homeSq, to: homeSq + 2, piece: king, castle: "K" });
    }
  }
  // Queen-side: b, c and d empty; e/d/c unattacked (b may be attacked).
  if (pos.castling.includes(rights.Q)) {
    const rookSq = homeSq - 4;
    const rook = color === "w" ? "R" : "r";
    if (
      pos.board[rookSq] === rook &&
      pos.board[homeSq - 1] === "" &&
      pos.board[homeSq - 2] === "" &&
      pos.board[homeSq - 3] === "" &&
      !isAttacked(pos, homeSq - 1, enemy) &&
      !isAttacked(pos, homeSq - 2, enemy)
    ) {
      out.push({ from: homeSq, to: homeSq - 2, piece: king, castle: "Q" });
    }
  }
}

/** Is `sq` attacked by any piece of `by`? */
export function isAttacked(pos: Position, sq: number, by: Color): boolean {
  // pawns
  const pawnDir = by === "w" ? 8 : -8; // squares a `by` pawn would attack FROM
  for (const d of [pawnDir - 1, pawnDir + 1]) {
    const from = step(sq, d);
    if (from === null) continue;
    const p = pos.board[from]!;
    if (p && colorOf(p) === by && typeOf(p) === "p") return true;
  }
  // knights
  for (const d of KNIGHT_DELTAS) {
    const from = step(sq, d);
    if (from === null) continue;
    const p = pos.board[from]!;
    if (p && colorOf(p) === by && typeOf(p) === "n") return true;
  }
  // king
  for (const d of KING_DELTAS) {
    const from = step(sq, d);
    if (from === null) continue;
    const p = pos.board[from]!;
    if (p && colorOf(p) === by && typeOf(p) === "k") return true;
  }
  // sliders
  for (const [dirs, types] of [
    [BISHOP_DIRS, ["b", "q"]],
    [ROOK_DIRS, ["r", "q"]]
  ] as const) {
    for (const d of dirs) {
      let cur = sq;
      for (;;) {
        const to = step(cur, d);
        if (to === null) break;
        const p = pos.board[to]!;
        if (p) {
          if (colorOf(p) === by && (types as readonly string[]).includes(typeOf(p))) return true;
          break;
        }
        cur = to;
      }
    }
  }
  return false;
}

export function kingSquare(pos: Position, color: Color): number {
  return pos.board.indexOf(color === "w" ? "K" : "k");
}

export function inCheck(pos: Position, color: Color = pos.turn): boolean {
  const k = kingSquare(pos, color);
  if (k === -1) return false;
  return isAttacked(pos, k, color === "w" ? "b" : "w");
}

/** Fully legal moves: pseudo-legal, minus anything that leaves the king in check. */
export function legalMoves(pos: Position, color: Color = pos.turn): MoveInfo[] {
  return pseudoLegalMoves(pos, color).filter((m) => {
    const next = applyMove(pos, m);
    return !inCheck(next, color);
  });
}

export function findMove(pos: Position, move: Move): MoveInfo | null {
  const wanted = legalMoves(pos).filter((m) => m.from === move.from && m.to === move.to);
  if (wanted.length === 0) return null;
  if (wanted.length === 1) return wanted[0]!;
  // Promotion: several moves share from/to.
  return wanted.find((m) => m.promo === (move.promo ?? "q")) ?? wanted[0]!;
}

/* -------------------------------------------------------------- applying */

/** Pure: returns a new position, never touches the input. */
export function applyMove(pos: Position, m: MoveInfo): Position {
  const board = pos.board.slice();
  const color = colorOf(m.piece);
  const t = typeOf(m.piece);

  board[m.from] = "";
  board[m.to] = m.promo ? (color === "w" ? m.promo.toUpperCase() : m.promo) : m.piece;

  if (m.enPassant) {
    const capSq = color === "w" ? m.to + 8 : m.to - 8;
    board[capSq] = "";
  }
  if (m.castle) {
    const home = color === "w" ? 60 : 4;
    if (m.castle === "K") {
      board[home + 1] = board[home + 3]!;
      board[home + 3] = "";
    } else {
      board[home - 1] = board[home - 4]!;
      board[home - 4] = "";
    }
  }

  // Castling rights: lost by moving the king or a rook, or by a rook's capture.
  let castling = pos.castling;
  const drop = (chars: string) => {
    for (const c of chars) castling = castling.replace(c, "");
  };
  if (t === "k") drop(color === "w" ? "KQ" : "kq");
  if (t === "r") {
    if (m.from === 63) drop("K");
    if (m.from === 56) drop("Q");
    if (m.from === 7) drop("k");
    if (m.from === 0) drop("q");
  }
  if (m.to === 63) drop("K");
  if (m.to === 56) drop("Q");
  if (m.to === 7) drop("k");
  if (m.to === 0) drop("q");

  return {
    board,
    turn: color === "w" ? "b" : "w",
    castling,
    ep: m.doublePush ? (m.from + m.to) / 2 : null,
    halfmove: t === "p" || m.captured ? 0 : pos.halfmove + 1,
    fullmove: color === "b" ? pos.fullmove + 1 : pos.fullmove
  };
}

/* ----------------------------------------------------------------- draws */

/**
 * K vs K, K+minor vs K, and same-coloured bishops — the positions where mate is
 * literally unreachable. Anything richer is playable and therefore not a draw.
 */
export function insufficientMaterial(pos: Position): boolean {
  const pieces: { sq: number; p: string }[] = [];
  for (let i = 0; i < 64; i++) if (pos.board[i]) pieces.push({ sq: i, p: pos.board[i]! });
  const nonKings = pieces.filter((x) => typeOf(x.p) !== "k");
  if (nonKings.length === 0) return true;
  if (nonKings.some((x) => ["p", "r", "q"].includes(typeOf(x.p)))) return false;
  if (nonKings.length === 1) return true; // lone bishop or knight
  if (nonKings.length === 2 && nonKings.every((x) => typeOf(x.p) === "b")) {
    const [a, b] = nonKings as [{ sq: number; p: string }, { sq: number; p: string }];
    if (colorOf(a.p) === colorOf(b.p)) return false; // two same-side bishops can mate
    const lightA = (file(a.sq) + rank(a.sq)) % 2;
    const lightB = (file(b.sq) + rank(b.sq)) % 2;
    return lightA === lightB;
  }
  return false;
}

/** Can `color` ever deliver mate with the material on the board? */
export function hasMatingMaterial(pos: Position, color: Color): boolean {
  const mine = pos.board.filter((p) => p && colorOf(p) === color).map(typeOf);
  if (mine.some((t) => t === "p" || t === "r" || t === "q")) return true;
  const bishops = mine.filter((t) => t === "b").length;
  const knights = mine.filter((t) => t === "n").length;
  if (bishops >= 2) return true;
  if (bishops >= 1 && knights >= 1) return true;
  if (knights >= 2) return true; // possible with help, and FIDE treats it as playable
  return false;
}

export type Outcome =
  | { over: false }
  | { over: true; kind: "checkmate"; winner: Color }
  | { over: true; kind: "stalemate" | "fifty" | "threefold" | "material"; winner: null };

export function outcome(pos: Position, repetitions: number): Outcome {
  const moves = legalMoves(pos);
  if (moves.length === 0) {
    if (inCheck(pos)) return { over: true, kind: "checkmate", winner: pos.turn === "w" ? "b" : "w" };
    return { over: true, kind: "stalemate", winner: null };
  }
  if (pos.halfmove >= 100) return { over: true, kind: "fifty", winner: null };
  if (repetitions >= 3) return { over: true, kind: "threefold", winner: null };
  if (insufficientMaterial(pos)) return { over: true, kind: "material", winner: null };
  return { over: false };
}
