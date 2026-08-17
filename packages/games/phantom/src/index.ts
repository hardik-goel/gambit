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
  type PhantomMove,
  type PhantomState,
  type PhantomView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 3,
  seed: "phantom-tutorial",
  steps: [
    { text: "One of you is the fugitive. Nobody else knows where they are." },
    { text: "The fugitive moves first each round. The city sees which line they took — never where they got off." },
    { text: "Detectives spend cab, tram and metro tickets. Every ticket you spend goes to the fugitive." },
    { text: "Five times in the game the fugitive surfaces and their position is shown to everyone." },
    { text: "Black tickets hide the line as well as the stop, and they're the only way across the river." },
    { text: "Land on the fugitive to win. Survive to the last round and the fugitive walks away." }
  ]
};

export const phantom: GameDefinition<PhantomState, PhantomMove, PhantomView> = {
  id: "phantom",
  version: "1.0.0",
  meta: {
    name: "Phantom",
    tagline: "One vanishes. Everyone hunts.",
    kind: "Hidden movement · one hides, the rest hunt",
    blurb: "A fugitive moves unseen through the city. Detectives close the net — or don't.",
    minPlayers: 3,
    maxPlayers: 6,
    avgMinutes: 40,
    complexity: 3,
    badges: ["Hidden role"],
    asymmetric: true,
    themeTokens: { hue: "#5a5f8f", felt: "#151726", accent: "#b3b8e0" }
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
    "fugitive-move": "swoosh",
    "detective-move": "pieceSet",
    sighting: "reveal",
    caught: "win",
    escaped: "lose",
    stuck: "error",
    round: "tap"
  }
};

export default phantom;
export * from "./city";
export { consistentSet } from "./bot";
export type { PhantomMove, PhantomState, PhantomView };
