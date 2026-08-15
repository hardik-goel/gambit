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
  type MosaicMove,
  type MosaicState,
  type MosaicView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 2,
  seed: "mosaic-tutorial",
  steps: [
    { text: "Take every tile of one colour from one factory. The rest slide to the middle." },
    { text: "Put them in a single pattern row. A row holds one colour and nothing else." },
    { text: "Fill a row completely and, at the end of the round, one tile moves to your wall." },
    { text: "Tiles score for the runs they join — a lone tile is worth one, a chain is worth its length." },
    { text: "Anything that doesn't fit lands on your floor, and the floor takes points away." },
    { text: "Complete a wall row and the game ends. Then rows, columns and full colours pay out." }
  ]
};

export const mosaic: GameDefinition<MosaicState, MosaicMove, MosaicView> = {
  id: "mosaic",
  version: "1.0.0",
  meta: {
    name: "Mosaic",
    tagline: "Draft beauty, punish greed",
    blurb: "Take tiles from the factories, build a perfect wall, mind the floor line.",
    minPlayers: 2,
    maxPlayers: 4,
    avgMinutes: 30,
    complexity: 2,
    badges: ["Drafting"],
    themeTokens: { hue: "#3f8f8a", felt: "#10231f", accent: "#9fd6cf" }
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
  predict,
  Board,
  Tutorial,
  invariants,
  describeMove,
  audioCues: {
    draft: "tileSnap",
    tile: "score",
    floor: "error",
    round: "bagDraw",
    "first-token": "tileSnap",
    "game-end": "win"
  }
};

export default mosaic;
export * from "./state";
