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
  type QuintetMove,
  type QuintetState,
  type QuintetView
} from "./state";

const Tutorial: TutorialScript = {
  seats: 2,
  seed: "quintet-tutorial",
  steps: [
    { text: "Every square shows a card, and every card is on the board twice.", spotlight: "board" },
    { text: "Play a card from your hand, put your chip on one of its two squares." },
    { text: "The four corners are wild — they count for everybody's five." },
    { text: "A two-eyed jack goes anywhere. A one-eyed jack lifts someone else's chip." },
    { text: "Both squares of a card taken? It's dead — swap it, once per turn." },
    { text: "Five in a row, any direction. Two of those and the game is yours." }
  ]
};

export const quintet: GameDefinition<QuintetState, QuintetMove, QuintetView> = {
  id: "quintet",
  version: "1.0.0",
  meta: {
    name: "Quintet",
    tagline: "Cards down, five in a row",
    kind: "Card-driven board game · five in a row",
    familiar: { title: "Sequence", publisher: "Jax Ltd." },
    blurb: "Play a card, place a chip, read the board. Team play at its purest.",
    minPlayers: 2,
    maxPlayers: 12,
    avgMinutes: 25,
    complexity: 1,
    badges: ["Teams"],
    teams: {
      modes: ["2v2", "3v3", "4v4"],
      assign: (seatCount, mode) => {
        const teams = Number(mode.split("v").length);
        return Array.from({ length: seatCount }, (_, i) => String(i % teams));
      }
    },
    themeTokens: { hue: "#3c6ea8", felt: "#132033", accent: "#a8c4e4" }
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
    place: "chipClack",
    remove: "chipStack",
    exchange: "cardSlip",
    sequence: "claim",
    win: "win",
    pass: "tap",
    exhausted: "score"
  }
};

export default quintet;
export * from "./layout";
export type { QuintetMove, QuintetState, QuintetView };
