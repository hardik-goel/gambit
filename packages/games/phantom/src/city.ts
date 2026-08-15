/**
 * Phantom's city: 120 numbered nodes and three transport layers laid over them.
 *
 * The map is generated once from a fixed seed and is therefore identical on
 * every device forever — but it is generated rather than transcribed, so it is
 * ours. Cabs run everywhere and go one street at a time. Trams link the larger
 * junctions. The metro connects a dozen hubs and crosses the city in a stride.
 * Four river crossings exist that only a black ticket opens.
 */
import { Rng } from "@gambit/sdk";

export type Transport = "cab" | "tram" | "metro" | "river";

export interface Node {
  id: number;
  x: number;
  y: number;
  /** Which layers stop here — drives how the node is drawn. */
  tram: boolean;
  metro: boolean;
}

export interface City {
  nodes: Node[];
  cab: [number, number][];
  tram: [number, number][];
  metro: [number, number][];
  river: [number, number][];
  /** Spawn pools, kept apart so the hunt doesn't start on top of the quarry. */
  fugitiveStarts: number[];
  detectiveStarts: number[];
}

const dist = (a: Node, b: Node): number => Math.hypot(a.x - b.x, a.y - b.y);

function build(): City {
  const rng = new Rng("gambit-phantom-city-v1");
  const nodes: Node[] = [];

  // A 12×10 lattice, jittered, so the city looks grown rather than ruled.
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 12; col++) {
      const id = nodes.length + 1;
      nodes.push({
        id,
        x: Math.round(60 + col * 74 + (rng.raw() - 0.5) * 34),
        y: Math.round(60 + row * 74 + (rng.raw() - 0.5) * 34),
        tram: false,
        metro: false
      });
    }
  }

  const byId = (id: number) => nodes[id - 1]!;
  const edgeKey = (a: number, b: number) => [a, b].sort((x, y) => x - y).join("-");

  /* ---- cabs: every node to its nearest few, then repaired into one network */
  const cabSet = new Set<string>();
  const cab: [number, number][] = [];
  const addCab = (a: number, b: number) => {
    if (a === b) return;
    const key = edgeKey(a, b);
    if (cabSet.has(key)) return;
    cabSet.add(key);
    cab.push([a, b]);
  };

  for (const node of nodes) {
    const near = nodes
      .filter((n) => n.id !== node.id)
      .sort((p, q) => dist(node, p) - dist(node, q))
      .slice(0, 3 + rng.int(2));
    for (const n of near) addCab(node.id, n.id);
  }

  // Repair: walk the components and stitch each stray one to its nearest node.
  for (let pass = 0; pass < 6; pass++) {
    const components = componentsOf(nodes.map((n) => n.id), cab);
    if (components.length === 1) break;
    const [first, ...rest] = components;
    for (const component of rest) {
      let best: [number, number] | null = null;
      let bestDistance = Infinity;
      for (const a of component) {
        for (const b of first!) {
          const d = dist(byId(a), byId(b));
          if (d < bestDistance) {
            bestDistance = d;
            best = [a, b];
          }
        }
      }
      if (best) addCab(best[0], best[1]);
    }
  }

  /* ---- trams: the larger junctions, linked at medium range */
  const tramStops = nodes
    .filter((n, i) => i % 3 === 0 || rng.raw() < 0.12)
    .slice(0, 40)
    .map((n) => n.id);
  for (const id of tramStops) byId(id).tram = true;

  const tram: [number, number][] = [];
  const tramSet = new Set<string>();
  for (const id of tramStops) {
    const near = tramStops
      .filter((other) => other !== id)
      .sort((p, q) => dist(byId(id), byId(p)) - dist(byId(id), byId(q)))
      .slice(0, 3);
    for (const other of near) {
      const key = edgeKey(id, other);
      if (tramSet.has(key)) continue;
      tramSet.add(key);
      tram.push([id, other]);
    }
  }
  stitch(tramStops, tram, tramSet, byId, edgeKey);

  /* ---- metro: a dozen hubs, a long ring with a couple of cross-city lines */
  const metroHubs = tramStops.filter((_, i) => i % 3 === 0).slice(0, 12);
  for (const id of metroHubs) byId(id).metro = true;
  const metro: [number, number][] = [];
  const metroSet = new Set<string>();
  const ring = [...metroHubs].sort((a, b) => {
    const ca = byId(a);
    const cb = byId(b);
    return Math.atan2(ca.y - 400, ca.x - 460) - Math.atan2(cb.y - 400, cb.x - 460);
  });
  ring.forEach((id, i) => {
    const next = ring[(i + 1) % ring.length]!;
    const key = edgeKey(id, next);
    if (metroSet.has(key)) return;
    metroSet.add(key);
    metro.push([id, next]);
  });
  // Two chords, so the metro is a shortcut rather than a slow circle.
  for (let i = 0; i < ring.length; i += Math.max(3, Math.floor(ring.length / 3))) {
    const a = ring[i]!;
    const b = ring[(i + Math.floor(ring.length / 2)) % ring.length]!;
    const key = edgeKey(a, b);
    if (metroSet.has(key)) continue;
    metroSet.add(key);
    metro.push([a, b]);
  }

  /* ---- the river: four crossings, black tickets only */
  const river: [number, number][] = [];
  const riverY = 400;
  const northBank = nodes.filter((n) => n.y < riverY && n.y > riverY - 90);
  const linked = new Set<string>([
    ...cab.map(([a, b]) => edgeKey(a, b)),
    ...tram.map(([a, b]) => edgeKey(a, b)),
    ...metro.map(([a, b]) => edgeKey(a, b))
  ]);
  for (let i = 0; i < 4; i++) {
    const from = northBank[Math.floor((i + 0.5) * (northBank.length / 4))];
    if (!from) continue;
    // A crossing must be a crossing: if the two banks are already joined by a
    // street or a line, it is not a river at all.
    const to = nodes
      .filter((n) => n.y > riverY && !linked.has(edgeKey(from.id, n.id)))
      .sort((p, q) => dist(from, p) - dist(from, q))[0];
    if (to) {
      river.push([from.id, to.id]);
      linked.add(edgeKey(from.id, to.id));
    }
  }

  /* ---- spawn pools, kept genuinely apart */
  // The fugitive starts somewhere in the middle of the city; the detectives
  // start where they can see a long way, and never within two streets of any
  // node the fugitive might have opened on.
  const sorted = [...nodes].sort((a, b) => a.x + a.y - (b.x + b.y));
  const fugitiveStarts = sorted.slice(45, 75).filter((_, i) => i % 2 === 0).map((n) => n.id);

  // "Two streets away" has to mean two of *any* kind of journey — a metro hub
  // is a long way on foot and no distance at all on the line.
  const cabAdj = new Map<number, number[]>();
  for (const [a, b] of [...cab, ...tram, ...metro]) {
    cabAdj.set(a, [...(cabAdj.get(a) ?? []), b]);
    cabAdj.set(b, [...(cabAdj.get(b) ?? []), a]);
  }
  const withinHops = (start: number, hops: number): Set<number> => {
    const seen = new Set([start]);
    let frontier = [start];
    for (let i = 0; i < hops; i++) {
      const next: number[] = [];
      for (const node of frontier) {
        for (const to of cabAdj.get(node) ?? []) {
          if (seen.has(to)) continue;
          seen.add(to);
          next.push(to);
        }
      }
      frontier = next;
    }
    return seen;
  };

  const tooClose = new Set<number>();
  for (const start of fugitiveStarts) for (const near of withinHops(start, 2)) tooClose.add(near);

  const detectiveStarts = nodes.map((n) => n.id).filter((id) => !tooClose.has(id));

  return { nodes, cab, tram, metro, river, fugitiveStarts, detectiveStarts };
}

function componentsOf(ids: number[], edges: [number, number][]): number[][] {
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const component: number[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const node = queue.shift()!;
      component.push(node);
      for (const next of adj.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    out.push(component);
  }
  return out;
}

function stitch(
  ids: number[],
  edges: [number, number][],
  set: Set<string>,
  byId: (id: number) => Node,
  edgeKey: (a: number, b: number) => string
): void {
  for (let pass = 0; pass < 6; pass++) {
    const components = componentsOf(ids, edges);
    if (components.length <= 1) return;
    const [first, ...rest] = components;
    for (const component of rest) {
      let best: [number, number] | null = null;
      let bestDistance = Infinity;
      for (const a of component) {
        for (const b of first!) {
          const d = Math.hypot(byId(a).x - byId(b).x, byId(a).y - byId(b).y);
          if (d < bestDistance) {
            bestDistance = d;
            best = [a, b];
          }
        }
      }
      if (best && !set.has(edgeKey(best[0], best[1]))) {
        set.add(edgeKey(best[0], best[1]));
        edges.push(best);
      }
    }
  }
}

export const CITY: City = build();

/** Adjacency by layer: `LINKS[node]` lists every way out and how it travels. */
export const LINKS: Map<number, { to: number; transport: Transport }[]> = (() => {
  const map = new Map<number, { to: number; transport: Transport }[]>();
  const add = (a: number, b: number, transport: Transport) => {
    map.set(a, [...(map.get(a) ?? []), { to: b, transport }]);
    map.set(b, [...(map.get(b) ?? []), { to: a, transport }]);
  };
  for (const [a, b] of CITY.cab) add(a, b, "cab");
  for (const [a, b] of CITY.tram) add(a, b, "tram");
  for (const [a, b] of CITY.metro) add(a, b, "metro");
  for (const [a, b] of CITY.river) add(a, b, "river");
  return map;
})();

export const exitsFrom = (node: number): { to: number; transport: Transport }[] => LINKS.get(node) ?? [];

/** Shortest hop count over the layers a detective can actually pay for. */
export function hopDistance(from: number, to: number, layers: Transport[] = ["cab", "tram", "metro"]): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let hops = 0;
  while (frontier.length && hops < 30) {
    hops++;
    const next: number[] = [];
    for (const node of frontier) {
      for (const exit of exitsFrom(node)) {
        if (!layers.includes(exit.transport)) continue;
        if (exit.to === to) return hops;
        if (seen.has(exit.to)) continue;
        seen.add(exit.to);
        next.push(exit.to);
      }
    }
    frontier = next;
  }
  return Infinity;
}

export const REVEAL_ROUNDS = [3, 8, 13, 18, 24];
export const FINAL_ROUND = 24;
