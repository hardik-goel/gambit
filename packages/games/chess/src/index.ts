import type { GameDefinition, TutorialScript } from "@gambit/sdk";
import { Board } from "./Board";
import { bot } from "./bot";
import {
  applyMove,
  configSchema,
  createState,
  currentSeats,
  describeMove,
  invariants,
  isTerminal,
  legalMoves,
  predict,
  redactStateFor,
  score,
  type ChessMove,
  type ChessState,
  type ChessView
} from "./state";
import { squareIndex } from "./rules";

const Tutorial: TutorialScript = {
  seats: 2,
  seed: "chess-tutorial",
  steps: [
    { text: "Every piece moves its own way. Tap a piece to see where it can go.", spotlight: "board" },
    {
      text: "Pawns step forward, capture diagonally, and reach two squares on their first move.",
      demoMove: { kind: "move", from: squareIndex("e2"), to: squareIndex("e4") }
    },
    { text: "Now it's Black's turn. Watch the clock — it only runs on the player to move." },
    {
      text: "Knights jump. This one comes out to f3, eyeing the middle.",
      demoMove: { kind: "move", from: squareIndex("g1"), to: squareIndex("f3") }
    },
    {
      text: "Castle early: king two squares toward the rook, and the rook hops over. Try it.",
      await: "castled"
    },
    {
      text: "Attack the king so it can't escape and the game ends. That's checkmate — the only thing that matters.",
      spotlight: "board"
    }
  ]
};

export const chess: GameDefinition<ChessState, ChessMove, ChessView> = {
  id: "chess",
  version: "1.0.0",
  meta: {
    name: "Chess",
    tagline: "The eternal duel",
    blurb: "Full classical rules, blitz and rapid clocks, and a ladder worth climbing.",
    minPlayers: 2,
    maxPlayers: 2,
    avgMinutes: 15,
    complexity: 3,
    badges: ["Ranked"],
    themeTokens: { hue: "#8a8474", felt: "#241a12", accent: "#d1b688" }
  },
  configSchema,
  createState,
  legalMoves,
  applyMove,
  currentSeats,
  redactStateFor: (state) => redactStateFor(state),
  isTerminal,
  score,
  bot,
  predict,
  Board,
  Tutorial,
  invariants,
  describeMove,
  audioCues: {
    move: "pieceSet",
    capture: "capture",
    check: "nudge",
    checkmate: "win",
    draw: "score",
    resign: "lose",
    timeout: "lose",
    "draw-offer": "nudge"
  }
};

export default chess;
export * from "./rules";
export * from "./san";
export { exportPgn, CLOCK_PRESETS } from "./state";
export type { ChessMove, ChessState, ChessView };
