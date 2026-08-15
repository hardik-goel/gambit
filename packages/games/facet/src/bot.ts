/**
 * The Facet bot.
 *
 * It values a purchase by prestige plus the engine the card leaves behind, and
 * values gems by how much closer they bring the cards it actually wants. Level 1
 * buys what it can see; level 2 plans one card ahead; level 3 also watches the
 * patrons and the cards its opponents are obviously building towards.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { GOLD, type DevCard, type Gem, type Noble } from "./cards";
import type { FacetMove, FacetView } from "./state";

function discountsOf(bought: DevCard[]): number[] {
  const d = [0, 0, 0, 0, 0];
  for (const c of bought) d[c.gem]!++;
  return d;
}

/** How many more tokens are needed to afford this card right now. */
function shortfall(card: DevCard, tokens: number[], discounts: number[]): number {
  let need = 0;
  let gold = tokens[GOLD]!;
  for (let g = 0; g < 5; g++) {
    const want = Math.max(0, card.cost[g]! - discounts[g]!);
    const missing = Math.max(0, want - tokens[g]!);
    const covered = Math.min(gold, missing);
    gold -= covered;
    need += missing - covered;
  }
  return need;
}

function nobleProgress(nobles: Noble[], discounts: number[], gem: Gem): number {
  let value = 0;
  for (const n of nobles) {
    if (n.requirement[gem]! === 0) continue;
    const remaining = n.requirement.reduce((sum, need, g) => sum + Math.max(0, need - discounts[g]!), 0);
    if (remaining === 0) continue;
    // The closer a patron is, the more each qualifying card is worth.
    value += Math.max(0, 6 - remaining);
  }
  return value;
}

export function bot(view: FacetView, legal: FacetMove[], rng: Rng, level: BotLevel): FacetMove {
  if (legal.length <= 1) return legal[0]!;
  const seat = view.seat === "spectator" ? view.turn : view.seat;
  const me = view.players[seat]!;
  const tokens = me.tokens.slice();
  const discounts = discountsOf(me.bought);

  const board: DevCard[] = ([1, 2, 3] as const).flatMap((t) =>
    view.rows[t].filter((c): c is DevCard => c !== null)
  );
  const wanted = [...board, ...view.reserved];

  /** How badly do I want one more of this gem? */
  const gemAppetite = (gem: Gem): number => {
    let appetite = 0;
    for (const card of wanted) {
      const need = Math.max(0, card.cost[gem]! - discounts[gem]!);
      if (need <= tokens[gem]!) continue;
      const gap = shortfall(card, tokens, discounts);
      if (gap === 0) continue;
      // Cards nearly within reach pull hardest.
      appetite += (card.prestige + 1) / (gap + 1);
    }
    if (level >= 3) appetite += nobleProgress(view.nobles, discounts, gem) * 0.15;
    return appetite;
  };

  const worth = (move: FacetMove): number => {
    switch (move.kind) {
      case "buy": {
        const card =
          move.source === "reserve"
            ? view.reserved[move.index]
            : view.rows[move.tier!]?.[move.index];
        if (!card) return -Infinity;
        let value = card.prestige * 6 + 4; // the discount itself is worth having
        if (level >= 2) {
          // A discount I'm short of is worth more than one I already have.
          value += Math.max(0, 3 - discounts[card.gem]!) * 1.5;
          value += nobleProgress(view.nobles, discounts, card.gem) * 0.5;
        }
        if (view.finishing) value += card.prestige * 4; // the clock is running
        return value;
      }
      case "take2": {
        return gemAppetite(move.gem) * 2 + 1;
      }
      case "take3": {
        return move.gems.reduce<number>((n, g) => n + gemAppetite(g), 0) + 0.5;
      }
      case "reserve": {
        if (move.index === -1) return level === 1 ? 0.2 : 0.05; // blind draws are a last resort
        const card = view.rows[move.tier]?.[move.index];
        if (!card) return -1;
        const gap = shortfall(card, tokens, discounts);
        // Reserve is for cards worth denying, or worth saving for.
        let value = card.prestige * 1.4 - gap * 0.5;
        if (view.bank[GOLD]! > 0) value += 1;
        if (me.reservedCount >= 2) value -= 3;
        return value;
      }
      case "pass":
        return -100;
      case "return": {
        // Give back whatever I want least.
        return -gemAppetite(move.gem as Gem);
      }
      case "noble":
        return 100;
      default:
        return 0;
    }
  };

  let best = legal[0]!;
  let bestScore = -Infinity;
  for (const move of legal) {
    const v = worth(move) + (level === 1 ? rng.raw() * 4 : rng.raw() * 0.5);
    if (v > bestScore) {
      bestScore = v;
      best = move;
    }
  }
  return best;
}
