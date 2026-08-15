import { describe, expect, it } from "vitest";
import { checkProperties, replay, simulate, simulateMany, makeBotSeats } from "@gambit/sdk/testkit";
import chess from "./index";
import {
  START_FEN,
  applyMove,
  insufficientMaterial,
  legalMoves,
  outcome,
  parseFen,
  squareIndex,
  toFen,
  findMove,
  inCheck
} from "./rules";
import { toSan } from "./san";
import type { ChessMove, ChessState } from "./state";

/** The standard correctness check: count leaf nodes to a given depth. */
function perft(fen: string, depth: number): number {
  const pos = parseFen(fen);
  const walk = (p: typeof pos, d: number): number => {
    if (d === 0) return 1;
    const moves = legalMoves(p);
    if (d === 1) return moves.length;
    let n = 0;
    for (const m of moves) n += walk(applyMove(p, m), d - 1);
    return n;
  };
  return walk(pos, depth);
}

describe("chess movement", () => {
  it("matches known perft counts from the start position", () => {
    expect(perft(START_FEN, 1)).toBe(20);
    expect(perft(START_FEN, 2)).toBe(400);
    expect(perft(START_FEN, 3)).toBe(8902);
    expect(perft(START_FEN, 4)).toBe(197281);
  });

  it("matches perft on the kiwipete position (castling, pins, en passant)", () => {
    const fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    expect(perft(fen, 1)).toBe(48);
    expect(perft(fen, 2)).toBe(2039);
    expect(perft(fen, 3)).toBe(97862);
  });

  it("matches perft on a position full of promotions", () => {
    const fen = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1";
    expect(perft(fen, 1)).toBe(14);
    expect(perft(fen, 2)).toBe(191);
    expect(perft(fen, 3)).toBe(2812);
    expect(perft(fen, 4)).toBe(43238);
  });

  it("round-trips FEN", () => {
    expect(toFen(parseFen(START_FEN))).toBe(START_FEN);
  });

  it("allows en passant only on the move right after the double push", () => {
    const pos = parseFen("8/8/8/8/4p3/8/3P4/K6k w - - 0 1");
    const push = findMove(pos, { from: squareIndex("d2"), to: squareIndex("d4") })!;
    const after = applyMove(pos, push);
    expect(after.ep).toBe(squareIndex("d3"));
    const ep = legalMoves(after).find((m) => m.enPassant);
    expect(ep).toBeTruthy();

    // A quiet move in between and the chance is gone.
    const quiet = findMove(after, { from: squareIndex("h1"), to: squareIndex("h2") })!;
    const later = applyMove(after, quiet);
    expect(later.ep).toBeNull();
    expect(legalMoves(later).some((m) => m.enPassant)).toBe(false);
  });

  it("refuses to castle through check", () => {
    const pos = parseFen("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
    expect(legalMoves(pos).filter((m) => m.castle)).toHaveLength(2);
    const attacked = parseFen("4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1");
    // f1 is attacked, so king-side is out; queen-side remains.
    const castles = legalMoves(attacked).filter((m) => m.castle);
    expect(castles.map((c) => c.castle)).toEqual(["Q"]);
  });

  it("detects checkmate, stalemate and dead positions", () => {
    const mate = parseFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
    expect(outcome(mate, 1)).toMatchObject({ over: true, kind: "checkmate", winner: "b" });

    const stale = parseFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(outcome(stale, 1)).toMatchObject({ over: true, kind: "stalemate" });

    expect(insufficientMaterial(parseFen("8/8/4k3/8/8/3K4/8/8 w - - 0 1"))).toBe(true);
    expect(insufficientMaterial(parseFen("8/8/4k3/8/8/3K1B2/8/8 w - - 0 1"))).toBe(true);
    expect(insufficientMaterial(parseFen("8/8/4k3/8/8/3K1R2/8/8 w - - 0 1"))).toBe(false);
  });

  it("writes SAN with disambiguation and check marks", () => {
    // Two knights on the d-file, both able to reach f4: rank disambiguates.
    const pos = parseFen("8/8/8/3N4/8/3N4/8/K5k1 w - - 0 1");
    const m = legalMoves(pos).find((x) => x.from === squareIndex("d5") && x.to === squareIndex("f4"))!;
    expect(toSan(pos, m)).toBe("N5f4");

    // Back-rank mate: the white king covers b7 and b8, so Rh8 is the end.
    const matePos = parseFen("k7/8/1K6/8/8/8/8/7R w - - 0 1");
    const rook = legalMoves(matePos).find((x) => x.to === squareIndex("h8"))!;
    expect(toSan(matePos, rook)).toBe("Rh8#");

    // A rook check the king simply walks away from is only a check.
    const checkPos = parseFen("k7/8/8/8/8/8/8/K5R1 w - - 0 1");
    const checking = legalMoves(checkPos).find((x) => x.to === squareIndex("g8"))!;
    expect(toSan(checkPos, checking)).toBe("Rg8+");
  });
});

describe("chess as a Gambit game", () => {
  const seats = makeBotSeats(2);
  const config = chess.configSchema.parse({});

  it("plays a scholar's mate and ends the game", () => {
    let state = chess.createState(config, seats, "test") as ChessState;
    const line: [string, string][] = [
      ["e2", "e4"], ["e7", "e5"], ["f1", "c4"], ["b8", "c6"], ["d1", "h5"], ["g8", "f6"], ["h5", "f7"]
    ];
    line.forEach(([from, to], i) => {
      const seat = i % 2;
      const move: ChessMove = { kind: "move", from: squareIndex(from), to: squareIndex(to) };
      const res = chess.applyMove(state, seat, move);
      expect(res.ok, `move ${from}${to} should be legal`).toBe(true);
      if (res.ok) state = res.value.state;
    });
    expect(chess.isTerminal(state)).toBe(true);
    expect(state.result?.kind).toBe("checkmate");
    const scores = chess.score(state);
    expect(scores.find((s) => s.won)?.seat).toBe(0);
  });

  it("explains an illegal move in one line instead of throwing", () => {
    const state = chess.createState(config, seats, "test") as ChessState;
    const res = chess.applyMove(state, 0, { kind: "move", from: squareIndex("e1"), to: squareIndex("e4") });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message.length).toBeGreaterThan(8);
  });

  it("flags on time only when the opponent can still mate", () => {
    const state = chess.createState(chess.configSchema.parse({ clock: "3+2" }), seats, "t") as ChessState;
    const started: ChessState = { ...state, clock: { ...state.clock, lastAt: 1_000, w: 5_000 } };
    const res = chess.applyMove(started, 0, {
      kind: "move",
      from: squareIndex("e2"),
      to: squareIndex("e4"),
      __at: 20_000
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.state.result?.kind).toBe("timeout");
      expect(res.value.state.result?.winner).toBe("b");
    }
  });

  it("hands out a view that is never the state itself", () => {
    const state = chess.createState(config, seats, "test") as ChessState;
    const view = chess.redactStateFor(state, 0);
    expect(view).not.toBe(state);
    expect(JSON.stringify(view)).not.toContain('"rng"');
  });

  it("predicts a move locally the same way the server applies it", () => {
    const state = chess.createState(config, seats, "test") as ChessState;
    const move: ChessMove = { kind: "move", from: squareIndex("e2"), to: squareIndex("e4") };
    const predicted = chess.predict!(chess.redactStateFor(state, 0), 0, move);
    const applied = chess.applyMove(state, 0, move);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(predicted.board).toEqual(chess.redactStateFor(applied.value.state, 0).board);
      expect(predicted.turn).toBe("b");
    }
  });

  it("holds its invariants across a random walk", () => {
    // The walk plays uniformly at random, so it resigns fairly often — the
    // point is that nothing breaks along the way, not that it plays well.
    const report = checkProperties(chess, { lines: 6, maxPly: 60 });
    expect(report.violations).toEqual([]);
    expect(report.checked).toBeGreaterThan(10);
  });

  it("finishes bot-versus-bot games cleanly", () => {
    const batch = simulateMany(chess, 12, { level: 1, maxPly: 400 });
    expect(batch.failures.map((f) => f.error)).toEqual([]);
    expect(batch.ok).toBe(12);
  });

  it("replays a finished game to the same fingerprint", () => {
    const sim = simulate(chess, { level: 1, seed: "replay-me", maxPly: 400 });
    expect(sim.error).toBeUndefined();
    const a = replay(chess, { seats, seed: sim.seed, log: sim.log });
    const b = replay(chess, { seats, seed: sim.seed, log: sim.log });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect((a.state as ChessState).history.length).toBe(sim.log.length);
  });

  it("never leaves a seat to move with nothing to play", () => {
    const state = chess.createState(config, seats, "x") as ChessState;
    const current = chess.currentSeats(state);
    expect(current).toEqual([0]);
    expect(chess.legalMoves(state, 0).length).toBeGreaterThan(20);
    expect(chess.legalMoves(state, 1)).toEqual([]);
  });

  it("keeps a king in check honest", () => {
    const pos = parseFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
    expect(inCheck(pos, "w")).toBe(true);
  });
});
