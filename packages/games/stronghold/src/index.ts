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
  type StrongholdMove,
  type StrongholdState,
  type StrongholdView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 3,
  seed: "stronghold-tutorial",
  steps: [
    { text: "Every turn starts with reinforcements: one for every three territories, at least three." },
    { text: "Hold a whole region and it pays a standing bonus, every turn, forever." },
    { text: "Attack from a territory with two or more armies into a neighbour." },
    { text: "Attacker rolls up to three dice, defender up to two. Highest against highest; ties go to the defender." },
    { text: "Take a territory and you choose how many armies march in — at least as many as you rolled." },
    { text: "Conquer anything at all this turn and you earn a card. Three cards make a set worth armies." },
    { text: "Finish with one fortifying move along your own supply line, and pass the dice on." }
  ]
};

export const stronghold: GameDefinition<StrongholdState, StrongholdMove, StrongholdView> = {
  id: "stronghold",
  version: "1.0.0",
  meta: {
    name: "Stronghold",
    tagline: "Hold the map or lose it",
    kind: "Area control · armies and territory",
    blurb: "Reinforce, attack, fortify. Regions pay dividends; hesitation pays nothing.",
    minPlayers: 2,
    maxPlayers: 6,
    avgMinutes: 75,
    complexity: 2,
    badges: ["Area control"],
    themeTokens: { hue: "#a6592e", felt: "#1d1410", accent: "#e0a469" }
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
    place: "cubePlace",
    battle: "diceTumble",
    conquest: "claim",
    occupy: "cubePlace",
    fortify: "cubePlace",
    trade: "gemClink",
    card: "cardSlip",
    eliminated: "lose",
    victory: "win",
    "setup-done": "start"
  }
};

export default stronghold;
export * from "./world";
export type { StrongholdMove, StrongholdState, StrongholdView };
