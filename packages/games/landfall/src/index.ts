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
  type LandfallMove,
  type LandfallState,
  type LandfallView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 3,
  seed: "landfall-tutorial",
  steps: [
    { text: "Place a settlement on a corner and a road beside it. Then again, in reverse order." },
    { text: "The second settlement pays out at once — one of everything it touches." },
    { text: "Every turn starts with two dice. Every hex showing that number pays whoever is on its corners." },
    { text: "A city pays double. A settlement pays one." },
    { text: "Roll a seven and everyone holding more than seven cards throws half away — then the robber moves." },
    { text: "Trade with the bank at four to one, better at a harbour, or with anyone who says yes." },
    { text: "Ten points wins: settlements, cities, the longest road, the largest army, and the charters nobody can see." }
  ]
};

export const landfall: GameDefinition<LandfallState, LandfallMove, LandfallView> = {
  id: "landfall",
  version: "1.0.0",
  meta: {
    name: "Landfall",
    tagline: "Settle, trade, out-build the island",
    kind: "Resource trading · build a settlement",
    familiar: { title: "CATAN", publisher: "Catan GmbH" },
    blurb: "Roll for resources, cut deals at the table, race to ten victory points.",
    minPlayers: 3,
    maxPlayers: 4,
    avgMinutes: 60,
    complexity: 3,
    badges: ["Trading"],
    themeTokens: { hue: "#4d8a52", felt: "#13251a", accent: "#a8d3a2" }
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
    roll: "diceTumble",
    produce: "cubePlace",
    settle: "claim",
    city: "claim",
    road: "pieceSet",
    robber: "swoosh",
    steal: "cardSlip",
    seven: "error",
    discard: "cardSlip",
    dev: "cardSlip",
    soldier: "capture",
    monopoly: "claim",
    trade: "gemClink",
    "bank-trade": "gemClink",
    offer: "nudge",
    victory: "win",
    "longest-road": "score",
    "largest-army": "score"
  }
};

export default landfall;
export * from "./island";
export type { LandfallMove, LandfallState, LandfallView };
