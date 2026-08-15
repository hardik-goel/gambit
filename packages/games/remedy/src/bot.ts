/**
 * The Remedy bots.
 *
 * A co-op bot has to play the team's game, not its own: it treats what is about
 * to break out, it carries cards towards whoever can use them, and it spends
 * its turn getting to a laboratory when a cure is within reach. Level 1 fights
 * fires; level 3 also thinks about the deck it is going to have to draw from.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { CITIES, ZONES, cityById, zoneOf, type Zone } from "./world";
import type { RemedyMove, RemedyView } from "./state";

/** Cubes on a city, read straight off the view. */
const cubesOn = (view: RemedyView, city: number, zone: Zone): number => view.cubes[city]?.[zone] ?? 0;

/** Hop distance over the road network, capped so it stays cheap. */
function hops(from: number, to: number, limit = 8): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 1; d <= limit; d++) {
    const next: number[] = [];
    for (const city of frontier) {
      for (const link of cityById(city).links) {
        if (link === to) return d;
        if (seen.has(link)) continue;
        seen.add(link);
        next.push(link);
      }
    }
    frontier = next;
  }
  return limit + 1;
}

/** How badly a city wants attention: three cubes is one card from an outbreak. */
function pressure(view: RemedyView, city: number): number {
  let value = 0;
  for (const zone of ZONES) {
    const cubes = cubesOn(view, city, zone);
    if (cubes === 0) continue;
    value += cubes * cubes; // three cubes are far worse than three cities of one
    if (view.infectionDiscard.includes(city)) value += cubes; // it will come round again
  }
  return value;
}

/** Zones this player is closest to curing. */
function cureProgress(view: RemedyView, seat: number): Record<Zone, number> {
  const need = view.roles[seat] === "scientist" ? 4 : 5;
  const out = { amber: 0, cobalt: 0, verdant: 0, rust: 0 } as Record<Zone, number>;
  for (const zone of ZONES) {
    if (view.cured[zone]) continue;
    const held = (view.hands[seat] ?? []).filter((c) => zoneOf(c) === zone).length;
    out[zone] = held / need;
  }
  return out;
}

export function bot(view: RemedyView, legal: RemedyMove[], rng: Rng, level: BotLevel): RemedyMove {
  if (legal.length <= 1) return legal[0]!;
  const seat = view.seat === "spectator" ? view.turn : view.seat;
  const here = view.positions[seat]!;
  const progress = cureProgress(view, seat);
  const bestZone = ZONES.slice().sort((a, b) => progress[b] - progress[a])[0]!;
  const nearestLab = view.labs.slice().sort((a, b) => hops(here, a) - hops(here, b))[0];

  const worth = (move: RemedyMove): number => {
    switch (move.kind) {
      case "cure":
        return 1000;
      case "consent":
        // Say yes to the courier unless it drags you off something urgent.
        return move.agree ? (pressure(view, here) > 4 ? -2 : 8) : 1;
      case "discard": {
        // Throw away whatever is least useful towards a cure.
        const zone = zoneOf(move.card);
        return -(progress[zone] * 10) - (move.card === here ? 2 : 0);
      }
      case "treat": {
        const cubes = cubesOn(view, here, move.zone);
        // Treating a three is the difference between a bad turn and a disaster.
        return 25 + cubes * 12 + (view.cured[move.zone] ? 8 : 0);
      }
      case "build": {
        if (view.labs.length >= 6) return -5;
        const nearest = nearestLab === undefined ? 99 : hops(here, nearestLab);
        // A laboratory is worth building where there isn't one for miles.
        return 6 + Math.min(nearest, 6) * 2.5;
      }
      case "share": {
        const zone = zoneOf(move.card);
        if (move.give) {
          // Hand a card to whoever is closer to curing that colour.
          const theirs = (view.hands[move.with] ?? []).filter((c) => zoneOf(c) === zone).length;
          const mine = (view.hands[seat] ?? []).filter((c) => zoneOf(c) === zone).length;
          return theirs >= mine ? 14 : -4;
        }
        const mine = (view.hands[seat] ?? []).filter((c) => zoneOf(c) === zone).length;
        const theirs = (view.hands[move.with] ?? []).filter((c) => zoneOf(c) === zone).length;
        return mine >= theirs ? 14 : -4;
      }
      case "drive":
      case "direct":
      case "charter":
      case "shuttle":
      case "engineer-flight": {
        const to = move.to;
        let value = pressure(view, to) * 2.2 - 1;
        // Head for a laboratory when a cure is nearly in hand.
        if (progress[bestZone] >= 0.75 && view.labs.includes(to)) value += 30;
        if (level >= 2) {
          // Prefer the move that costs nothing when one is available.
          if (move.kind === "drive" || move.kind === "shuttle") value += 3;
          else value -= 4; // spending a card has to buy something
        }
        if (level >= 3 && view.infectionDiscard.includes(to)) value += 2;
        return value + rng.raw() * (level === 1 ? 4 : 0.6);
      }
      case "courier-move": {
        const to = move.to;
        return pressure(view, to) * 1.5 - 2;
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
  return best;
}

export { hops as cityDistance, pressure as cityPressure, CITIES };
