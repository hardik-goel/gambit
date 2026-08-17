/**
 * Boxcar's six maps.
 *
 * The data lives in `maps/*.json` — cities with coordinates, routes with
 * length, colour, tunnel and ferry flags, and the destination tickets. All of
 * it is original to Gambit (see LEGAL.md); none of it is transcribed from any
 * published board.
 */
import archipelago from "../maps/archipelago.json";
import continental from "../maps/continental.json";
import frontier from "../maps/frontier.json";
import meridian from "../maps/meridian.json";
import nordic from "../maps/nordic.json";
import subcontinent from "../maps/subcontinent.json";

export const CARD_COLOURS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "black",
  "white"
] as const;

export type CardColour = (typeof CARD_COLOURS)[number];
export type Card = CardColour | "loco";
/** A route is a colour, or grey — grey takes any single colour. */
export type RouteColour = CardColour | "gray";

export const COLOUR_HEX: Record<string, string> = {
  red: "#c8402f",
  orange: "#d98632",
  yellow: "#d9b93b",
  green: "#4d8a52",
  blue: "#3c6ea8",
  purple: "#8a5ba6",
  black: "#3a3632",
  white: "#efeadb",
  gray: "#a89f8c",
  loco: "#6b5b73"
};

export interface City {
  key: string;
  name: string;
  x: number;
  y: number;
}

export interface Route {
  id: number;
  a: string;
  b: string;
  len: number;
  color: RouteColour;
  tunnel: boolean;
  /** Minimum locomotives that must appear in the payment; 0 for dry land. */
  ferry: number;
  /** The id of the parallel track, when this route is one of a double. */
  twin?: number;
}

export interface Ticket {
  id: number;
  a: string;
  b: string;
  points: number;
  long: boolean;
}

export interface BoxcarMap {
  id: string;
  name: string;
  tagline: string;
  stations: boolean;
  cities: City[];
  routes: Route[];
  tickets: Ticket[];
}

export const MAPS: Record<string, BoxcarMap> = {
  continental: continental as BoxcarMap,
  frontier: frontier as BoxcarMap,
  subcontinent: subcontinent as BoxcarMap,
  // Meridian is the big one: Continental runs out of track before a
  // five-player game finds its ending, and 91 routes is what fixes that.
  meridian: meridian as BoxcarMap,
  archipelago: archipelago as BoxcarMap,
  nordic: nordic as BoxcarMap
};

export const MAP_IDS = Object.keys(MAPS);

/** Route points by length — the whole reason to build long. */
export const ROUTE_POINTS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 4,
  4: 7,
  5: 10,
  6: 15,
  8: 21
};

export const routePoints = (len: number): number => ROUTE_POINTS[len] ?? len * 3;

/** 110 cards: twelve of each colour, fourteen locomotives. */
export function makeTrainDeck(): Card[] {
  const deck: Card[] = [];
  for (const colour of CARD_COLOURS) for (let i = 0; i < 12; i++) deck.push(colour);
  for (let i = 0; i < 14; i++) deck.push("loco");
  return deck;
}

export function adjacency(map: BoxcarMap, routeIds: number[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of routeIds) {
    const r = map.routes[id]!;
    adj.set(r.a, [...(adj.get(r.a) ?? []), r.b]);
    adj.set(r.b, [...(adj.get(r.b) ?? []), r.a]);
  }
  return adj;
}

export function citiesConnected(map: BoxcarMap, routeIds: number[], from: string, to: string): boolean {
  if (from === to) return true;
  const adj = adjacency(map, routeIds);
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const city = queue.shift()!;
    for (const next of adj.get(city) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Shortest route length between two cities over the whole map. */
export function shortestPath(map: BoxcarMap, from: string, to: string): number {
  const dist = new Map<string, number>([[from, 0]]);
  const queue: [string, number][] = [[from, 0]];
  const edges = new Map<string, Route[]>();
  for (const r of map.routes) {
    edges.set(r.a, [...(edges.get(r.a) ?? []), r]);
    edges.set(r.b, [...(edges.get(r.b) ?? []), r]);
  }
  while (queue.length) {
    queue.sort((x, y) => x[1] - y[1]);
    const [city, d] = queue.shift()!;
    if (city === to) return d;
    if (d > (dist.get(city) ?? Infinity)) continue;
    for (const r of edges.get(city) ?? []) {
      const next = r.a === city ? r.b : r.a;
      const nd = d + r.len;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        queue.push([next, nd]);
      }
    }
  }
  return Infinity;
}

/**
 * The longest continuous trail through a player's own routes — each route used
 * once, cities revisitable.
 *
 * This is the longest-trail problem, which is NP-hard in general. A real
 * player's network is small and sparse (a car supply of 45 buys about twenty
 * routes), so an exhaustive depth-first search is both correct and instant. The
 * step budget exists so that a pathological network — a stress test, a corrupt
 * state, someone's idea of a joke — degrades into a good answer rather than
 * hanging the server. It is never reached in a real game.
 */
export const TRAIL_SEARCH_BUDGET = 400_000;

export function longestTrail(map: BoxcarMap, routeIds: number[]): number {
  const routes = routeIds.map((id) => map.routes[id]!);
  const byCity = new Map<string, number[]>();
  routes.forEach((r, i) => {
    byCity.set(r.a, [...(byCity.get(r.a) ?? []), i]);
    byCity.set(r.b, [...(byCity.get(r.b) ?? []), i]);
  });

  let best = 0;
  let steps = 0;
  const used = new Set<number>();
  const walk = (city: string, length: number): void => {
    if (length > best) best = length;
    if (steps++ > TRAIL_SEARCH_BUDGET) return;
    for (const i of byCity.get(city) ?? []) {
      if (used.has(i)) continue;
      const r = routes[i]!;
      used.add(i);
      walk(r.a === city ? r.b : r.a, length + r.len);
      used.delete(i);
      if (steps > TRAIL_SEARCH_BUDGET) return;
    }
  };
  for (const city of byCity.keys()) {
    walk(city, 0);
    if (steps > TRAIL_SEARCH_BUDGET) break;
  }
  return best;
}
