/**
 * Facet's development cards and nobles.
 *
 * The deck is generated from cost templates rather than transcribed: each tier
 * has a set of shapes, and every shape is cut once in each of the five gems,
 * rotating which gem is cheap and which is dear. Ninety cards, balanced by
 * construction, and the same on every device.
 */

export const GEMS = ["onyx", "ruby", "emerald", "sapphire", "topaz"] as const;
export type Gem = 0 | 1 | 2 | 3 | 4;
export const GEM_HEX = ["#3b3a42", "#a63f4c", "#3f8a5e", "#3a6ea8", "#c3a03c"];
/** The wild: gold, taken only by reserving. */
export const GOLD = 5;

export interface DevCard {
  id: string;
  tier: 1 | 2 | 3;
  /** The permanent discount this card provides once bought. */
  gem: Gem;
  prestige: number;
  /** Cost in each gem, indexed by Gem. */
  cost: number[];
}

interface Template {
  prestige: number;
  /** Relative costs: index 0 is the card's own gem, then the next four in order. */
  shape: [number, number, number, number, number];
}

/** Eight cheap shapes: broad, low-value engine pieces. */
const TIER1: Template[] = [
  { prestige: 0, shape: [0, 1, 1, 1, 1] },
  { prestige: 0, shape: [0, 1, 2, 1, 1] },
  { prestige: 0, shape: [0, 2, 2, 0, 1] },
  { prestige: 0, shape: [0, 0, 1, 3, 1] },
  { prestige: 0, shape: [0, 0, 2, 2, 0] },
  { prestige: 0, shape: [0, 3, 0, 0, 0] },
  { prestige: 0, shape: [1, 0, 2, 2, 0] },
  { prestige: 1, shape: [0, 0, 0, 4, 0] }
];

/** Six middle shapes: the bridge between a broad base and real prestige. */
const TIER2: Template[] = [
  { prestige: 1, shape: [0, 0, 3, 2, 2] },
  { prestige: 1, shape: [0, 2, 3, 0, 3] },
  { prestige: 2, shape: [0, 0, 5, 0, 0] },
  { prestige: 2, shape: [0, 0, 1, 4, 2] },
  { prestige: 2, shape: [0, 5, 3, 0, 0] },
  { prestige: 3, shape: [6, 0, 0, 0, 0] }
];

/** Four expensive shapes: the cards games are decided by. */
const TIER3: Template[] = [
  { prestige: 3, shape: [0, 3, 3, 5, 3] },
  { prestige: 4, shape: [0, 0, 7, 0, 0] },
  { prestige: 4, shape: [3, 0, 6, 3, 0] },
  { prestige: 5, shape: [3, 0, 7, 0, 0] }
];

function cut(tier: 1 | 2 | 3, templates: Template[]): DevCard[] {
  const cards: DevCard[] = [];
  for (let gem = 0; gem < 5; gem++) {
    templates.forEach((t, i) => {
      const cost = [0, 0, 0, 0, 0];
      t.shape.forEach((amount, k) => {
        cost[(gem + k) % 5] = amount;
      });
      cards.push({
        id: `t${tier}-${GEMS[gem]}-${i}`,
        tier,
        gem: gem as Gem,
        prestige: t.prestige,
        cost
      });
    });
  }
  return cards;
}

export const DECK_1 = cut(1, TIER1); // 40
export const DECK_2 = cut(2, TIER2); // 30
export const DECK_3 = cut(3, TIER3); // 20

export function deckFor(tier: 1 | 2 | 3): DevCard[] {
  return tier === 1 ? DECK_1 : tier === 2 ? DECK_2 : DECK_3;
}

export interface Noble {
  id: string;
  prestige: number;
  /** How many cards of each gem this patron expects to see. */
  requirement: number[];
}

/**
 * Ten patrons: five who want depth in two gems, five who want breadth in three.
 * Each is worth three prestige and visits exactly once.
 */
export const NOBLES: Noble[] = [
  ...Array.from({ length: 5 }, (_, g) => {
    const req = [0, 0, 0, 0, 0];
    req[g] = 4;
    req[(g + 1) % 5] = 4;
    return { id: `noble-pair-${g}`, prestige: 3, requirement: req };
  }),
  ...Array.from({ length: 5 }, (_, g) => {
    const req = [0, 0, 0, 0, 0];
    req[g] = 3;
    req[(g + 1) % 5] = 3;
    req[(g + 2) % 5] = 3;
    return { id: `noble-trio-${g}`, prestige: 3, requirement: req };
  })
];

export const tokensPerGem = (players: number): number => (players === 2 ? 4 : players === 3 ? 5 : 7);
