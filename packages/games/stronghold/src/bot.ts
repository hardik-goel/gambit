/**
 * The Stronghold bot.
 *
 * It reads the odds table rather than guessing them, and it thinks about
 * borders: a territory worth taking is one that shortens the line it has to
 * defend, or completes a region that pays. Level 1 attacks on instinct, level 3
 * only when the arithmetic agrees.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { BATTLE_ODDS, REGIONS, byKey, territoriesIn } from "./world";
import type { StrongholdMove, StrongholdView } from "./state";

/** Rough chance of taking a territory, given the garrisons on both sides. */
export function captureChance(attackers: number, defenders: number): number {
  let a = attackers - 1;
  let d = defenders;
  // Walk the expected exchange rather than simulating: good enough to decide.
  for (let round = 0; round < 40 && a > 0 && d > 0; round++) {
    // Armies are whole things when dice are rolled, even mid-estimate.
    const attackDice = Math.min(3, Math.max(1, Math.ceil(a)));
    const defenceDice = Math.min(2, Math.max(1, Math.ceil(d)));
    const odds = BATTLE_ODDS[`${attackDice}v${defenceDice}`]!;
    a -= odds.attackerLoses;
    d -= odds.defenderLoses;
  }
  if (d <= 0 && a > 0) return Math.min(1, 0.5 + a / (attackers || 1) / 2);
  return Math.max(0, a / (a + d + 0.001)) * 0.5;
}

export function bot(view: StrongholdView, legal: StrongholdMove[], rng: Rng, level: BotLevel): StrongholdMove {
  if (legal.length <= 1) return legal[0]!;
  const seat = view.seat === "spectator" ? view.turn : view.seat;
  const mine = Object.keys(view.owner).filter((k) => view.owner[k] === seat);

  /** How exposed a territory is: enemy armies on its borders. */
  const threat = (key: string): number =>
    byKey(key)
      .borders.filter((b) => view.owner[b] !== seat)
      .reduce((n, b) => n + (view.armies[b] ?? 0), 0);

  /** Territories still needed to complete a region. */
  const regionGap = (key: string): number => {
    const region = byKey(key).region;
    const all = territoriesIn(region);
    const held = all.filter((k) => view.owner[k] === seat).length;
    return all.length - held;
  };

  const objectiveWants = (key: string): number => {
    const objective = view.objective;
    if (!objective) return 0;
    if (objective.kind === "regions") return objective.regions.includes(byKey(key).region) ? 6 : 0;
    if (objective.kind === "any-regions") return regionGap(key) <= 2 ? 4 : 0;
    if (objective.kind === "territories") return 2;
    if (objective.kind === "eliminate") return view.owner[key] === objective.seat ? 6 : 1;
    return 0;
  };

  const worth = (move: StrongholdMove): number => {
    switch (move.kind) {
      case "trade":
        return 100; // sets are always worth cashing
      case "place": {
        // Reinforce the border that is under the most pressure, and the region
        // that is closest to paying out.
        const bonus = REGIONS.find((r) => r.key === byKey(move.territory).region)?.bonus ?? 0;
        const gap = regionGap(move.territory);
        return (
          threat(move.territory) * 1.2 +
          (gap === 0 ? bonus * 0.8 : gap <= 2 ? bonus * 0.5 : 0) +
          objectiveWants(move.territory) +
          rng.raw() * (level === 1 ? 6 : 1)
        );
      }
      case "attack": {
        const attackers = view.armies[move.from] ?? 0;
        const defenders = view.armies[move.to] ?? 0;
        const chance = captureChance(attackers, defenders);
        let floor = level === 1 ? 0.35 : level === 2 ? 0.55 : 0.62;
        // Sitting on a big army and refusing to use it is how a map stalls.
        // The stronger the stack, the more willing this bot is to spend it.
        const myArmies = mine.reduce((n, k) => n + (view.armies[k] ?? 0), 0);
        const allArmies = Object.values(view.armies).reduce((n, v) => n + v, 0);
        const share = allArmies > 0 ? myArmies / allArmies : 0;
        if (share > 1.3 / Math.max(2, Object.keys(view.names).length)) floor -= 0.12;
        if (attackers >= defenders * 2 + 2) floor -= 0.1;
        if (chance < floor) return -20;

        const gapBefore = regionGap(move.to);
        let value = chance * 12;
        if (gapBefore === 1) value += 14; // this attack completes a region
        else if (gapBefore <= 3) value += 4;
        value += objectiveWants(move.to) * 1.5;
        if (level >= 2) {
          // Taking a territory whose other neighbours are already mine shortens
          // the line rather than lengthening it.
          const friendly = byKey(move.to).borders.filter((b) => view.owner[b] === seat).length;
          value += friendly * 1.5;
        }
        if (level >= 3 && !view.conquered) value += 3; // the turn's card is worth having
        return value + rng.raw() * (level === 1 ? 5 : 0.8);
      }
      case "occupy": {
        // Push forward, but never strip the territory you came from bare.
        const from = view.occupation?.from;
        const exposure = from ? threat(from) : 0;
        const ideal = Math.max(1, Math.round((view.occupation?.maximum ?? 1) * (exposure > 4 ? 0.5 : 0.85)));
        return -Math.abs(move.count - ideal);
      }
      case "end-attack":
        return level === 1 ? 1 : 0.5;
      case "fortify": {
        // Move armies from a quiet interior towards the noisy border.
        const gain = threat(move.to) - threat(move.from);
        return gain * 1.2 + move.count * 0.1;
      }
      case "end-turn":
        return 0.4;
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
  void mine;
  return best;
}
