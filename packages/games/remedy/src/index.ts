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
  type RemedyMove,
  type RemedyState,
  type RemedyView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 3,
  seed: "remedy-tutorial",
  steps: [
    { text: "You all win together, or you all lose together. There is no winner here." },
    { text: "Four actions a turn: move, build, treat, share what you know, or find a cure." },
    { text: "Then you draw two cards, and then the board takes its turn and infects more cities." },
    { text: "A fourth cube in one city is an outbreak — it spills into every neighbour, and those can chain." },
    { text: "Five cards of one colour in a laboratory cures it. Four, if you're the scientist." },
    { text: "Eight outbreaks, an empty deck, or a colour running out of cubes and it's over." },
    { text: "Every role bends one rule. Read yours, and plan out loud." }
  ]
};

export const remedy: GameDefinition<RemedyState, RemedyMove, RemedyView> = {
  id: "remedy",
  version: "1.0.0",
  meta: {
    name: "Remedy",
    tagline: "Beat the board — together",
    kind: "Co-operative · beat the board together",
    blurb: "Four afflictions spread across the world. Your team cures all of them, or no one wins.",
    minPlayers: 2,
    maxPlayers: 5,
    avgMinutes: 45,
    complexity: 3,
    badges: ["Co-op"],
    coop: true,
    asymmetric: true,
    themeTokens: { hue: "#3f7f6a", felt: "#0f1f1b", accent: "#9fd6c0" }
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
    treat: "cure",
    cure: "cure",
    build: "tileSnap",
    share: "cardSlip",
    infect: "cubePlace",
    outbreak: "outbreak",
    epidemic: "outbreak",
    eradicated: "win",
    won: "win",
    lost: "lose",
    discard: "cardSlip",
    request: "nudge",
    courier: "swoosh"
  }
};

export default remedy;
export * from "./world";
export type { RemedyMove, RemedyState, RemedyView };
