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
  type HamletMove,
  type HamletState,
  type HamletView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 2,
  seed: "hamlet-tutorial",
  steps: [
    { text: "Draw a tile and lay it so the edges match: road to road, wall to wall, field to field." },
    { text: "After laying it you may stand one meeple on something you just drew — if nobody's on it." },
    { text: "A road pays a point a tile once both ends are closed." },
    { text: "A keep pays two a tile, and two more for every banner inside it." },
    { text: "A shrine pays nine once all eight squares around it are filled." },
    { text: "When the last tile is laid, whatever is unfinished still pays — a little." }
  ]
};

export const hamlet: GameDefinition<HamletState, HamletMove, HamletView> = {
  id: "hamlet",
  version: "1.0.0",
  meta: {
    name: "Hamlet",
    tagline: "Lay the land, tile by tile",
    kind: "Tile laying · build a countryside",
    blurb: "Grow a countryside of roads and keeps, and claim it with your meeples.",
    minPlayers: 2,
    maxPlayers: 5,
    avgMinutes: 35,
    complexity: 2,
    badges: ["Tile laying"],
    themeTokens: { hue: "#7a8a4d", felt: "#1b2013", accent: "#cbd79a" }
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
    tile: "tileSnap",
    meeple: "meeple",
    score: "claim",
    "final-score": "score",
    discard: "cardSlip",
    "game-end": "win"
  }
};

export default hamlet;
export * from "./tiles";
export type { HamletMove, HamletState, HamletView };
