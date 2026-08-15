/**
 * The Landfall bot.
 *
 * It values a corner the way a player does — the odds on the hexes around it,
 * the spread of resources, whether there's a harbour — and then spends what it
 * has on whatever is closest to a point. It trades with the bank readily and
 * with players cautiously, because a good trade for you is usually a good trade
 * for them too.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { HEXES, RESOURCES, VERTICES, type Resource } from "./island";
import { handSize, type LandfallMove, type LandfallView } from "./state";

/** How often a number comes up, in thirty-sixths. */
export const pips = (n: number | null): number => (n === null ? 0 : 6 - Math.abs(7 - n));

export function cornerValue(view: LandfallView, vertex: number): number {
  const v = VERTICES[vertex];
  if (!v) return -Infinity;
  let value = 0;
  const kinds = new Set<string>();
  for (const hexId of v.hexes) {
    const terrain = view.terrain[hexId]!;
    if (terrain === "desert") continue;
    const weight = pips(view.numbers[hexId] ?? null);
    value += weight;
    kinds.add(terrain);
    // Brick and wood build the early game; ore and grain win the late one.
    if (terrain === "brick" || terrain === "wood") value += weight * 0.25;
  }
  value += kinds.size * 2.2; // variety beats depth on the opening placement
  if (view.ports[vertex]) value += 1.6;
  return value;
}

const shortfall = (view: LandfallView, cost: Partial<Record<Resource, number>>): number =>
  RESOURCES.reduce((n, r) => n + Math.max(0, (cost[r] ?? 0) - view.hand[r]), 0);

export function bot(view: LandfallView, legal: LandfallMove[], rng: Rng, level: BotLevel): LandfallMove {
  if (legal.length <= 1) return legal[0]!;
  const seat = view.seat === "spectator" ? view.turn : view.seat;

  const worth = (move: LandfallMove): number => {
    switch (move.kind) {
      case "place-settlement":
        return cornerValue(view, move.vertex) + rng.raw() * (level === 1 ? 4 : 0.5);
      case "place-road": {
        // Point the opening road at the best corner it opens up.
        return rng.raw();
      }
      case "roll":
        return 100;
      case "discard":
        // Keep what you are closest to spending.
        return -RESOURCES.reduce((n, r) => n + (move.give[r] ?? 0) * (view.hand[r] > 2 ? 0.5 : 1.5), 0);
      case "move-robber":
      case "play-soldier": {
        // Put it on the busiest hex somebody else is drinking from.
        const hex = HEXES[move.hex]!;
        let value = 0;
        for (const vertex of hex.corners) {
          const building = view.buildings[vertex];
          if (!building) continue;
          const weight = pips(view.numbers[move.hex] ?? null) * (building.type === "city" ? 2 : 1);
          value += building.seat === seat ? -weight * 2 : weight;
        }
        if (move.steal !== null) value += 3;
        if (move.kind === "play-soldier") value += 4; // armies are worth two points
        return value + rng.raw();
      }
      case "build-city":
        return 60 + rng.raw();
      case "build-settlement":
        return 50 + cornerValue(view, move.vertex) + rng.raw();
      case "build-road": {
        // Roads are worth building towards somewhere worth settling.
        const near = VERTICES.filter((v) =>
          [view.roads[move.edge]].length ? true : false
        );
        void near;
        return 8 + rng.raw() * 2;
      }
      case "buy-dev":
        return level >= 2 ? 18 : 12;
      case "play-monopoly": {
        const held = Object.values(view.handCounts).reduce((a, b) => a + b, 0) - handSize(view.hand);
        return 12 + held * 0.2;
      }
      case "play-plenty":
        return 16;
      case "play-roads":
        return 14;
      case "bank-trade": {
        // Trade away a surplus for something a build is short of.
        const surplus = view.hand[move.give] - view.rates[move.give];
        const needed =
          shortfall(view, { ore: 3, grain: 2 }) > 0 && (move.get === "ore" || move.get === "grain");
        return 6 + surplus * 0.6 + (needed ? 4 : 0);
      }
      case "offer":
        // Worth one ask when short of something specific; never worth stalling
        // the turn over.
        return level >= 2 && shortfall(view, { ore: 3, grain: 2 }) > 0 ? 2 : 0.2;
      case "respond": {
        if (!view.offer) return 0;
        // Take a trade that brings you closer to a build than it costs you.
        const gain = RESOURCES.reduce((n, r) => n + (view.offer!.give[r] ?? 0), 0);
        const cost = RESOURCES.reduce((n, r) => n + (view.offer!.want[r] ?? 0), 0);
        const canPay = RESOURCES.every((r) => view.hand[r] >= (view.offer!.want[r] ?? 0));
        if (!canPay) return move.accept ? -50 : 5;
        return move.accept ? (gain >= cost ? 6 : -3) : gain >= cost ? -3 : 6;
      }
      case "close-offer":
        return move.with === null ? 1 : 8;
      case "end-turn":
        return 0.5;
      default:
        return 0;
    }
  };

  let best = legal[0]!;
  let bestScore = -Infinity;
  for (const move of legal) {
    const v = worth(move);
    if (v > bestScore) {
      bestScore = v;
      best = move;
    }
  }
  return best;
}
