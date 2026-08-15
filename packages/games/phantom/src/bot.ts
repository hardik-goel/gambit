/**
 * The Phantom bots — two minds, because the two roles play different games.
 *
 * The detectives reconstruct the *consistent set*: every node the fugitive
 * could be standing on, given the sightings and the transport types in the log.
 * They then move to shrink that set and to close the distance to its centre.
 *
 * The fugitive does the same arithmetic in reverse: it keeps the set large and
 * the detectives far, and it spends black tickets exactly when a plain ticket
 * would give the game away.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { CITY, exitsFrom, hopDistance, type Transport } from "./city";
import type { PhantomMove, PhantomView } from "./state";

/**
 * Every node the fugitive could be on, given the public record.
 * This is exactly the information a good human detective is working from.
 */
export function consistentSet(view: PhantomView, blockedNodes: number[] = []): Set<number> {
  let candidates = new Set<number>(CITY.fugitiveStarts);

  for (const entry of view.log) {
    if (entry.node !== null) {
      // A sighting collapses everything to one node.
      candidates = new Set([entry.node]);
      continue;
    }
    const next = new Set<number>();
    for (const node of candidates) {
      for (const exit of exitsFrom(node)) {
        // A black ticket could have been anything, including the river.
        if (entry.transport !== "black" && exit.transport !== entry.transport) continue;
        if (blockedNodes.includes(exit.to)) continue;
        next.add(exit.to);
      }
    }
    candidates = next;
  }
  return candidates;
}

function centreOf(nodes: Iterable<number>): { x: number; y: number } | null {
  let n = 0;
  let x = 0;
  let y = 0;
  for (const id of nodes) {
    const node = CITY.nodes[id - 1];
    if (!node) continue;
    x += node.x;
    y += node.y;
    n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

export function bot(view: PhantomView, legal: PhantomMove[], rng: Rng, level: BotLevel): PhantomMove {
  if (legal.length <= 1) return legal[0]!;
  const seat = view.seat === "spectator" ? view.toMove : view.seat;
  const detectiveSeats = Object.keys(view.positions)
    .map(Number)
    .filter((s) => s !== view.fugitiveSeat);
  const detectiveNodes = detectiveSeats
    .map((s) => view.positions[s])
    .filter((n): n is number => typeof n === "number");

  /* ------------------------------------------------------- the fugitive */
  if (view.amFugitive) {
    const tickets = view.tickets[seat]!;
    const nearestDetective = (node: number): number =>
      Math.min(...detectiveNodes.map((d) => hopDistance(d, node)));

    const worth = (move: PhantomMove): number => {
      if (move.kind === "stuck") return -100;
      let value = nearestDetective(move.to) * 3;
      // Room to run matters as much as distance: a dead end is a trap.
      value += exitsFrom(move.to).length * 0.4;

      if (move.transport === "black") {
        // Black tickets are precious. Spend them on the river, on a reveal
        // round, or when a detective is breathing down your neck.
        const worthIt =
          exitsFrom(view.positions[seat] as number).some(
            (e) => e.to === move.to && e.transport === "river"
          ) ||
          view.revealRounds.includes(view.round) ||
          nearestDetective(view.positions[seat] as number) <= 2;
        value += worthIt ? 6 : -8;
        if (tickets.black <= 1 && !worthIt) value -= 6;
      }
      if (move.double) {
        // Doubles are for escapes, not for scenery.
        value += nearestDetective(view.positions[seat] as number) <= 2 ? 7 : -9;
      }
      if (level >= 2 && move.transport === "metro") value += 2; // a long stride hides you
      return value + rng.raw() * (level === 1 ? 6 : 1);
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

  /* ------------------------------------------------------ the detectives */
  const candidates = consistentSet(view, detectiveNodes);
  const centre = centreOf(candidates.size ? candidates : new Set(CITY.fugitiveStarts));

  const worth = (move: PhantomMove): number => {
    if (move.kind === "stuck") return -100;
    // Standing on a candidate node is a catch if the guess is right.
    if (candidates.has(move.to)) return 100 + rng.raw();

    let value = 0;
    if (candidates.size > 0 && candidates.size <= 40) {
      // Close on the nearest place the fugitive could be.
      const nearest = Math.min(...[...candidates].map((c) => hopDistance(move.to, c)));
      value += (12 - Math.min(12, nearest)) * 2.5;
    }
    if (centre) {
      const node = CITY.nodes[move.to - 1]!;
      const away = Math.hypot(node.x - centre.x, node.y - centre.y);
      value += Math.max(0, 12 - away / 60);
    }
    // Spread out: two detectives standing next to each other cover one street.
    const crowding = detectiveNodes.filter((d) => hopDistance(d, move.to) <= 1).length;
    value -= crowding * (level >= 2 ? 3 : 1);

    const tickets = view.tickets[seat]!;
    if (move.transport !== "black" && move.transport !== "river") {
      // Don't burn the scarce metro tickets on a short hop.
      if (move.transport === "metro" && tickets.metro <= 1) value -= 4;
      if (move.transport === "cab" && tickets.cab <= 2) value -= 2;
    }
    return value + rng.raw() * (level === 1 ? 5 : 0.8);
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

export type { Transport };
