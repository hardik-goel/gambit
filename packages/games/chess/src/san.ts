/** Standard Algebraic Notation and PGN export. */
import {
  applyMove,
  colorOf,
  file,
  inCheck,
  legalMoves,
  rank,
  squareName,
  typeOf,
  type MoveInfo,
  type Position
} from "./rules";

export function toSan(pos: Position, m: MoveInfo): string {
  if (m.castle) {
    const base = m.castle === "K" ? "O-O" : "O-O-O";
    return base + suffix(pos, m);
  }
  const t = typeOf(m.piece);
  if (t === "p") {
    const cap = m.captured ? `${"abcdefgh"[file(m.from)]}x` : "";
    const promo = m.promo ? `=${m.promo.toUpperCase()}` : "";
    return `${cap}${squareName(m.to)}${promo}${suffix(pos, m)}`;
  }

  // Disambiguate against every other same-type move landing on the same square.
  const rivals = legalMoves(pos, colorOf(m.piece)).filter(
    (o) => o.to === m.to && o.from !== m.from && typeOf(o.piece) === t
  );
  let disambig = "";
  if (rivals.length > 0) {
    const sameFile = rivals.some((o) => file(o.from) === file(m.from));
    const sameRank = rivals.some((o) => rank(o.from) === rank(m.from));
    if (!sameFile) disambig = "abcdefgh"[file(m.from)]!;
    else if (!sameRank) disambig = String(rank(m.from) + 1);
    else disambig = squareName(m.from);
  }
  return `${t.toUpperCase()}${disambig}${m.captured ? "x" : ""}${squareName(m.to)}${suffix(pos, m)}`;
}

function suffix(pos: Position, m: MoveInfo): string {
  const next = applyMove(pos, m);
  if (!inCheck(next, next.turn)) return "";
  return legalMoves(next).length === 0 ? "#" : "+";
}

export interface PgnInput {
  white: string;
  black: string;
  san: string[];
  result: string;
  date?: string;
  event?: string;
  site?: string;
  startFen?: string;
}

export function toPgn(input: PgnInput): string {
  const tags = [
    `[Event "${input.event ?? "Gambit table"}"]`,
    `[Site "${input.site ?? "Gambit"}"]`,
    `[Date "${input.date ?? "????.??.??"}"]`,
    `[White "${input.white}"]`,
    `[Black "${input.black}"]`,
    `[Result "${input.result}"]`
  ];
  if (input.startFen) {
    tags.push(`[SetUp "1"]`, `[FEN "${input.startFen}"]`);
  }
  const body: string[] = [];
  for (let i = 0; i < input.san.length; i += 2) {
    const no = i / 2 + 1;
    body.push(`${no}. ${input.san[i]}${input.san[i + 1] ? ` ${input.san[i + 1]}` : ""}`);
  }
  return `${tags.join("\n")}\n\n${body.join(" ")} ${input.result}`.trim();
}
