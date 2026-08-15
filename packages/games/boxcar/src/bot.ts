/**
 * The Boxcar bot.
 *
 * It plays the way people do: work out which routes its tickets actually need,
 * claim those first, hoard the colours they call for, and take more tickets
 * only when the network is already doing the work. Level 1 is loose about all
 * of that; level 3 also blocks the route it would hate to lose.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { MAPS, routePoints, type BoxcarMap, type CardColour } from "./maps";
import type { BoxcarMove, BoxcarView, Hand } from "./state";

/**
 * Cheapest path between two cities where routes the player already owns are
 * free, unclaimed routes cost their length, and other players' routes are
 * impassable. Returns the route ids on that path, or null.
 */
export function neededRoutes(
  map: BoxcarMap,
  claims: Record<number, number>,
  seat: number,
  from: string,
  to: string
): number[] | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { city: string; route: number }>();
  const queue: [string, number][] = [[from, 0]];
  const byCity = new Map<string, number[]>();
  map.routes.forEach((r) => {
    byCity.set(r.a, [...(byCity.get(r.a) ?? []), r.id]);
    byCity.set(r.b, [...(byCity.get(r.b) ?? []), r.id]);
  });

  while (queue.length) {
    queue.sort((a, b) => a[1] - b[1]);
    const [city, d] = queue.shift()!;
    if (city === to) break;
    if (d > (dist.get(city) ?? Infinity)) continue;
    for (const id of byCity.get(city) ?? []) {
      const r = map.routes[id]!;
      const owner = claims[id];
      if (owner !== undefined && owner !== seat) continue;
      const cost = owner === seat ? 0 : r.len;
      const next = r.a === city ? r.b : r.a;
      const nd = d + cost;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, { city, route: id });
        queue.push([next, nd]);
      }
    }
  }

  if (!dist.has(to)) return null;
  const path: number[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = prev.get(cursor);
    if (!step) return null;
    if (claims[step.route] !== seat) path.push(step.route);
    cursor = step.city;
  }
  return path;
}

/** How useful each unclaimed route is to this player's outstanding tickets. */
function ticketDemand(view: BoxcarView): Map<number, number> {
  const map = MAPS[view.mapId]!;
  const seat = view.seat === "spectator" ? view.turn : view.seat;
  const demand = new Map<number, number>();
  for (const ticket of view.tickets) {
    if (ticket.done) continue;
    const path = neededRoutes(map, view.claims, seat, ticket.a, ticket.b);
    if (!path) continue;
    const remaining = path.reduce((n, id) => n + map.routes[id]!.len, 0);
    if (remaining === 0) continue;
    // A ticket nearly finished pulls harder than one barely started.
    const weight = ticket.points / Math.max(1, remaining);
    for (const id of path) demand.set(id, (demand.get(id) ?? 0) + ticket.points * 0.5 + weight * 4);
  }
  return demand;
}

/** Colours the player is collecting towards, weighted by how much is needed. */
function colourAppetite(view: BoxcarView, demand: Map<number, number>): Record<string, number> {
  const map = MAPS[view.mapId]!;
  const appetite: Record<string, number> = { loco: 3 };
  for (const [id, value] of demand) {
    const route = map.routes[id]!;
    const hand = view.hand as Hand;
    if (route.color === "gray") {
      // Grey wants whatever is already deepest in hand.
      let bestColour: CardColour | null = null;
      let bestCount = -1;
      for (const [colour, count] of Object.entries(hand)) {
        if (colour === "loco") continue;
        if (count > bestCount) {
          bestCount = count;
          bestColour = colour as CardColour;
        }
      }
      if (bestColour) appetite[bestColour] = (appetite[bestColour] ?? 0) + value * 0.5;
    } else {
      appetite[route.color] = (appetite[route.color] ?? 0) + value;
    }
    if (route.ferry) appetite.loco = (appetite.loco ?? 0) + value * 0.4;
  }
  return appetite;
}

export function bot(view: BoxcarView, legal: BoxcarMove[], rng: Rng, level: BotLevel): BoxcarMove {
  if (legal.length === 1) return legal[0]!;
  const map = MAPS[view.mapId]!;
  const seat = view.seat === "spectator" ? view.turn : view.seat;
  const demand = ticketDemand(view);
  const appetite = colourAppetite(view, demand);
  const cars = view.cars[seat] ?? 0;
  const handTotal = Object.values(view.hand as Hand).reduce((a, b) => a + b, 0);

  // Ticket keep decisions come first — they set everything else up.
  const keeps = legal.filter((m): m is Extract<BoxcarMove, { kind: "keep" }> => m.kind === "keep");
  if (keeps.length) {
    const value = (ids: number[]) =>
      ids.reduce((total, id) => {
        const offered = view.offered.find((o) => o.id === id);
        if (!offered) return total;
        const path = neededRoutes(map, view.claims, seat, offered.a, offered.b);
        if (!path) return total - offered.points; // unreachable: a straight loss
        const cost = path.reduce((n, rid) => n + map.routes[rid]!.len, 0);
        if (cost > cars) return total - offered.points * 0.8;
        // Points per car spent, with a nudge towards cheap tickets early.
        return total + offered.points - cost * (level === 1 ? 1.4 : 1.1);
      }, 0);
    let best = keeps[0]!;
    let bestValue = -Infinity;
    for (const move of keeps) {
      const v = value(move.ids) + rng.raw() * 0.5;
      if (v > bestValue) {
        bestValue = v;
        best = move;
      }
    }
    return best;
  }

  const tunnelPay = legal.find((m) => m.kind === "tunnel-pay");
  if (tunnelPay) return tunnelPay; // having committed, finish the job
  const withdraw = legal.find((m) => m.kind === "tunnel-withdraw");
  if (withdraw && !tunnelPay) return withdraw;

  const worth = (move: BoxcarMove): number => {
    switch (move.kind) {
      case "claim": {
        const route = map.routes[move.route]!;
        let value = routePoints(route.len) + (demand.get(move.route) ?? 0) * 2;
        // Spending locomotives on a route that doesn't need them is waste.
        value -= move.locos * (route.ferry ? 0.4 : 2.2);
        if (level >= 2 && demand.has(move.route)) value += 6;
        if (level >= 3 && route.twin !== undefined && view.claims[route.twin] !== undefined) {
          value += 3; // the last track of a pair is worth taking
        }
        if (view.finalLap) value += routePoints(route.len);
        // Don't strand the network by burning cars on nothing useful.
        if (!demand.has(move.route) && cars < 12) value -= 8;
        return value;
      }
      case "draw": {
        if (move.from === "deck") return 3 + (handTotal < 6 ? 2 : 0);
        const card = view.market[move.from];
        if (!card) return -1;
        const want = appetite[card] ?? 0.5;
        // A face-up locomotive costs the whole turn, so it must be worth it.
        if (card === "loco") return view.drawsLeft === 2 ? 4.5 + want * 0.3 : -1;
        return 2.5 + want * 0.6;
      }
      case "tickets": {
        // More tickets are only worth it while there is time to build them.
        if (view.finalLap || cars < 14) return -5;
        const outstanding = view.tickets.filter((t) => !t.done).length;
        return outstanding === 0 ? 6 : outstanding <= 1 ? 3 : -3;
      }
      case "station": {
        // A station is worth four points unbuilt, so it must beat that.
        const failing = view.tickets.filter((t) => !t.done).length;
        if (!view.finalLap && failing === 0) return -6;
        return failing > 0 && cars < 10 ? 5 : -4;
      }
      default:
        return -50;
    }
  };

  let best = legal[0]!;
  let bestScore = -Infinity;
  for (const move of legal) {
    const v = worth(move) + (level === 1 ? rng.raw() * 5 : rng.raw() * 0.6);
    if (v > bestScore) {
      bestScore = v;
      best = move;
    }
  }
  return best;
}
