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
  type BoxcarMove,
  type BoxcarState,
  type BoxcarView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 2,
  seed: "boxcar-tutorial",
  steps: [
    { text: "Your tickets are two cities and a number. Connect them, collect the number." },
    { text: "A turn is one thing: draw two cards, claim a route, or take more tickets." },
    { text: "To claim a route, spend cards of its colour — grey takes any one colour." },
    { text: "A face-up locomotive is wild, but taking one costs your whole draw." },
    { text: "Dashed routes are tunnels: three cards are turned over and may demand more." },
    { text: "Anchors mean a ferry — that crossing insists on locomotives." },
    { text: "When someone is down to two cars, everyone gets one last turn. Then it's counted." }
  ]
};

export const boxcar: GameDefinition<BoxcarState, BoxcarMove, BoxcarView> = {
  id: "boxcar",
  version: "1.0.0",
  meta: {
    name: "Boxcar",
    tagline: "Claim routes, connect the map",
    kind: "Route building · collect and claim",
    familiar: { title: "Ticket to Ride", publisher: "Days of Wonder" },
    blurb: "Draw cards, claim rail lines, complete secret tickets across three continents.",
    minPlayers: 2,
    maxPlayers: 5,
    avgMinutes: 45,
    complexity: 2,
    badges: ["3 maps"],
    themeTokens: { hue: "#b08d3f", felt: "#14202e", accent: "#d8c58a" }
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
    draw: "cardDeal",
    claim: "claim",
    station: "tileSnap",
    tunnel: "reveal",
    "tunnel-paid": "trainClack",
    "tunnel-withdrawn": "error",
    "tickets-drawn": "cardSlip",
    "tickets-kept": "cardSlip",
    "final-lap": "nudge",
    "game-end": "win",
    start: "trainClack",
    pass: "tap"
  }
};

export default boxcar;
export * from "./maps";
export type { BoxcarMove, BoxcarState, BoxcarView };
