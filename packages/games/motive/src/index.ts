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
  redactStateFor,
  score,
  type MotiveMove,
  type MotiveState,
  type MotiveView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 3,
  seed: "motive-tutorial",
  steps: [
    { text: "One suspect, one implement and one room are sealed in the case file. Everything else is dealt out." },
    { text: "Your own cards are proof: whatever you hold is not the answer." },
    { text: "Roll, move through the corridors, and step into a room to ask a question." },
    { text: "Name a suspect and an implement — the room is the one you're standing in." },
    { text: "Going clockwise, the first player holding any of the three must show you one, privately." },
    { text: "Nobody could answer? Then you are very close indeed." },
    { text: "Accuse once, and only once. Right and you win; wrong and you answer questions for the rest of the night." }
  ]
};

export const motive: GameDefinition<MotiveState, MotiveMove, MotiveView> = {
  id: "motive",
  version: "1.0.0",
  meta: {
    name: "Motive",
    tagline: "Someone at this table did it",
    kind: "Deduction · work out who, where and how",
    familiar: { title: "Cluedo / Clue", publisher: "Hasbro" },
    blurb: "Suggest, disprove, deduce. Accuse when certain — accuse wrong and you're out.",
    minPlayers: 3,
    maxPlayers: 6,
    avgMinutes: 45,
    complexity: 2,
    badges: ["Deduction"],
    themeTokens: { hue: "#8a3b3b", felt: "#1d1214", accent: "#dba28f" }
  },
  configSchema,
  createState,
  legalMoves,
  applyMove,
  currentSeats,
  redactStateFor,
  isTerminal,
  score,
  bot,
  Board,
  Tutorial,
  invariants,
  describeMove,
  audioCues: {
    move: "pieceSet",
    passage: "swoosh",
    suggest: "nudge",
    disproved: "cardSlip",
    "disproved-private": "cardFlip",
    unchallenged: "reveal",
    pass: "tap",
    solved: "win",
    wrong: "lose",
    unsolved: "score",
    roll: "diceTumble"
  }
};

export default motive;
export * from "./mansion";
export { notepad } from "./bot";
export type { MotiveMove, MotiveState, MotiveView };
