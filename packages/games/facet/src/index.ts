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
  type FacetMove,
  type FacetState,
  type FacetView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 2,
  seed: "facet-tutorial",
  steps: [
    { text: "One action a turn. Take three different gems, or two of the same from a deep pile." },
    { text: "Spend gems on a card. The card stays yours as a permanent discount." },
    { text: "Discounts stack, so the third card of a colour costs far less than the first." },
    { text: "Reserve a card to keep it from someone else — you get a gold wild for the trouble." },
    { text: "Patrons visit anyone whose cards meet their taste. Three prestige each, no action needed." },
    { text: "Fifteen prestige starts the last round. Fewest cards wins a tie." }
  ]
};

export const facet: GameDefinition<FacetState, FacetMove, FacetView> = {
  id: "facet",
  version: "1.0.0",
  meta: {
    name: "Facet",
    tagline: "Build a jewel of an engine",
    kind: "Engine building · gems, cards and patrons",
    blurb: "Collect gems, chain discounts, court the patrons, hit fifteen prestige first.",
    minPlayers: 2,
    maxPlayers: 4,
    avgMinutes: 30,
    complexity: 2,
    badges: ["Engine"],
    themeTokens: { hue: "#8a5ba6", felt: "#1b1428", accent: "#d3b4ea" }
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
    take: "gemClink",
    buy: "gemClink",
    reserve: "cardSlip",
    noble: "claim",
    return: "gemClink",
    "game-end": "win",
    pass: "tap"
  }
};

export default facet;
export * from "./cards";
export type { FacetMove, FacetState, FacetView };
