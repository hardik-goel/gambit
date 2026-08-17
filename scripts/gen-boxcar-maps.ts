/**
 * Builds Boxcar's generated maps.
 *
 *   pnpm exec tsx scripts/gen-boxcar-maps.ts
 *
 * A map is a city layout plus a route graph, and only the first of those is
 * worth authoring by hand. The cities — real places, at positions that read
 * like the part of the world they belong to — are written below. The routes
 * are derived: near neighbours joined, crossings removed so the board reads
 * like a board, lengths from distance, colours balanced across the whole map,
 * doubles where traffic will concentrate, tunnels through mountains and
 * ferries across water where the layout says so.
 *
 * Deriving them is not a shortcut. It is what keeps a 90-route map connected,
 * colour-balanced and solvable, all of which are properties this script checks
 * before it writes anything. A hand-typed graph of that size is a graph with a
 * mistake in it.
 *
 * Everything here is Gambit's own: our city sets, our coordinates, our route
 * graph, our tickets. Places are facts and nobody owns them; a published
 * board's particular layout is not, and none of it is transcribed. See
 * LEGAL.md.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../packages/games/boxcar/maps/", import.meta.url).pathname;

type Terrain = "plain" | "mountain" | "port";

interface CitySpec {
  key: string;
  name: string;
  x: number;
  y: number;
  terrain?: Terrain;
}

interface MapSpec {
  id: string;
  name: string;
  tagline: string;
  stations: boolean;
  /** Roughly how many routes the finished map should carry. */
  routes: number;
  /** Sea crossings, as city pairs; these become ferries. */
  water?: [string, string][];
  cities: CitySpec[];
  seed: number;
}

/* ------------------------------------------------------------------ rng */

/** The same seeded generator the games use, so a map is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------- geometry */

const dist = (a: CitySpec, b: CitySpec): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Do two segments cross? Shared endpoints do not count. */
function crosses(p1: CitySpec, p2: CitySpec, p3: CitySpec, p4: CitySpec): boolean {
  if (p1.key === p3.key || p1.key === p4.key || p2.key === p3.key || p2.key === p4.key) return false;
  const d = (a: CitySpec, b: CitySpec, c: CitySpec): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/* ---------------------------------------------------------------- routes */

interface Edge {
  a: string;
  b: string;
  d: number;
}

function buildEdges(spec: MapSpec): Edge[] {
  const by = new Map(spec.cities.map((c) => [c.key, c]));
  const candidates: Edge[] = [];
  for (let i = 0; i < spec.cities.length; i++) {
    for (let j = i + 1; j < spec.cities.length; j++) {
      const a = spec.cities[i]!;
      const b = spec.cities[j]!;
      candidates.push({ a: a.key, b: b.key, d: dist(a, b) });
    }
  }
  candidates.sort((x, y) => x.d - y.d);

  const kept: Edge[] = [];
  const degree = new Map<string, number>(spec.cities.map((c) => [c.key, 0]));

  for (const edge of candidates) {
    if (kept.length >= spec.routes) break;
    // Long hops make a board unreadable, and a city with eight lines out of it
    // is a hub nobody can compete for.
    if (edge.d > 190) continue;
    if ((degree.get(edge.a) ?? 0) >= 5 || (degree.get(edge.b) ?? 0) >= 5) continue;

    const a = by.get(edge.a)!;
    const b = by.get(edge.b)!;
    const clashes = kept.some((other) =>
      crosses(a, b, by.get(other.a)!, by.get(other.b)!)
    );
    if (clashes) continue;

    kept.push(edge);
    degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
    degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
  }

  // Anything the distance rule stranded gets joined to its nearest neighbour,
  // because a city nobody can reach is a city that should not be on the board.
  for (const city of spec.cities) {
    if ((degree.get(city.key) ?? 0) > 0) continue;
    const nearest = spec.cities
      .filter((other) => other.key !== city.key)
      .sort((p, q) => dist(city, p) - dist(city, q))[0]!;
    kept.push({ a: city.key, b: nearest.key, d: dist(city, nearest) });
    degree.set(city.key, 1);
    degree.set(nearest.key, (degree.get(nearest.key) ?? 0) + 1);
  }

  return kept;
}

/** One island of track is a map; two is two maps sharing a page. */
function connected(cities: CitySpec[], edges: Edge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const seen = new Set<string>([cities[0]!.key]);
  const queue = [cities[0]!.key];
  while (queue.length) {
    for (const next of adj.get(queue.shift()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === cities.length;
}

/**
 * Shortest path measured in track, not in hops.
 *
 * A ticket is priced against the track it takes to complete, which is what the
 * suite checks and what a player actually pays. Counting hops prices a run of
 * five one-car links the same as a single five-car haul.
 */
function shortestTrack(
  cities: CitySpec[],
  weighted: { a: string; b: string; len: number }[],
  from: string
): Map<string, number> {
  const adj = new Map<string, { to: string; len: number }[]>();
  for (const e of weighted) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, len: e.len });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, len: e.len });
  }
  const best = new Map<string, number>([[from, 0]]);
  const queue = new Set<string>(cities.map((c) => c.key));
  while (queue.size) {
    let here: string | null = null;
    for (const key of queue) {
      if (here === null || (best.get(key) ?? Infinity) < (best.get(here) ?? Infinity)) here = key;
    }
    if (here === null || (best.get(here) ?? Infinity) === Infinity) break;
    queue.delete(here);
    for (const next of adj.get(here) ?? []) {
      const through = (best.get(here) ?? Infinity) + next.len;
      if (through < (best.get(next.to) ?? Infinity)) best.set(next.to, through);
    }
  }
  return best;
}

function shortestHops(cities: CitySpec[], edges: Edge[], from: string): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const seen = new Map<string, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const here = queue.shift()!;
    for (const next of adj.get(here) ?? []) {
      if (seen.has(next)) continue;
      seen.set(next, seen.get(here)! + 1);
      queue.push(next);
    }
  }
  void cities;
  return seen;
}

const COLOURS = ["red", "orange", "yellow", "green", "blue", "purple", "black", "white"] as const;

function build(spec: MapSpec) {
  const random = rng(spec.seed);
  const by = new Map(spec.cities.map((c) => [c.key, c]));
  const edges = buildEdges(spec);

  if (!connected(spec.cities, edges)) {
    throw new Error(`${spec.id}: the map is in more than one piece`);
  }

  const water = new Set((spec.water ?? []).map(([a, b]) => [a, b].sort().join("|")));
  const counts = new Map<string, number>(COLOURS.map((c) => [c, 0]));
  const routes: Record<string, unknown>[] = [];
  let id = 0;

  for (const edge of edges) {
    const a = by.get(edge.a)!;
    const b = by.get(edge.b)!;

    // Length from distance, so a long line on the board is a long line to buy.
    const len = Math.max(1, Math.min(6, Math.round(edge.d / 34)));

    const mountain = a.terrain === "mountain" || b.terrain === "mountain";
    const sea = water.has([edge.a, edge.b].sort().join("|"));

    // Grey takes any colour, so it is where a map breathes; too much of it and
    // no card is ever the wrong card.
    const grey = random() < (len >= 5 ? 0.5 : 0.22);
    let colour = "gray";
    if (!grey) {
      // The least-used colour, so no hand is dead and no colour is gold.
      const fewest = [...counts].sort((x, y) => x[1] - y[1] || (random() < 0.5 ? -1 : 1))[0]!;
      colour = fewest[0];
      counts.set(colour, fewest[1] + 1);
    }

    const route: Record<string, unknown> = {
      id,
      a: edge.a,
      b: edge.b,
      len,
      color: colour,
      tunnel: mountain && random() < 0.65,
      ferry: sea ? (len >= 4 ? 2 : 1) : 0
    };
    routes.push(route);
    id++;

    // A double track keeps a busy corridor contestable at a full table.
    const busy = len <= 3 && random() < 0.2;
    if (busy) {
      const twinColour =
        colour === "gray"
          ? "gray"
          : COLOURS[Math.floor(random() * COLOURS.length)] ?? "gray";
      route.twin = id;
      routes.push({
        id,
        a: edge.a,
        b: edge.b,
        len,
        color: twinColour,
        tunnel: route.tunnel,
        ferry: route.ferry,
        twin: (route.id as number)
      });
      if (twinColour !== "gray") counts.set(twinColour, (counts.get(twinColour) ?? 0) + 1);
      id++;
    }
  }

  /* ------------------------------------------------------------ tickets */

  const tickets: Record<string, unknown>[] = [];
  const used = new Set<string>();
  const keys = spec.cities.map((c) => c.key);

  // One entry per pair of cities, in track. Doubles do not shorten anything, so
  // the first of a twinned pair is enough.
  const weighted = routes
    .filter((r) => (r.twin as number | undefined) === undefined || (r.id as number) < (r.twin as number))
    .map((r) => ({ a: r.a as string, b: r.b as string, len: r.len as number }));
  const track = new Map(keys.map((k) => [k, shortestTrack(spec.cities, weighted, k)]));

  let longest = 0;
  for (const from of keys) {
    for (const away of track.get(from)!.values()) {
      if (Number.isFinite(away)) longest = Math.max(longest, away);
    }
  }

  // A ticket has to be completable by one player out of forty-five cars, and
  // "long" is relative to this board rather than to a number I picked.
  const CARS = 45;
  const longAt = Math.max(12, Math.round(Math.min(longest, CARS - 6) * 0.8));

  const far: { a: string; b: string; away: number }[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const away = track.get(keys[i]!)!.get(keys[j]!);
      if (away === undefined || !Number.isFinite(away)) continue;
      if (away >= longAt && away <= CARS - 6) far.push({ a: keys[i]!, b: keys[j]!, away });
    }
  }
  far.sort((x, y) => y.away - x.away);
  for (const pick of far.slice(0, 6)) {
    used.add([pick.a, pick.b].sort().join("|"));
    // Priced at the track it takes, which is the promise the board makes.
    tickets.push({ id: tickets.length, a: pick.a, b: pick.b, points: pick.away, long: true });
  }

  const wanted = Math.round(spec.cities.length * 0.85);
  let guard = 0;
  while (tickets.length < wanted && guard++ < 60_000) {
    const a = keys[Math.floor(random() * keys.length)]!;
    const b = keys[Math.floor(random() * keys.length)]!;
    if (a === b) continue;
    const pair = [a, b].sort().join("|");
    if (used.has(pair)) continue;
    const away = track.get(a)!.get(b);
    if (away === undefined || !Number.isFinite(away)) continue;
    if (away < 6 || away >= longAt || away > CARS - 6) continue;

    used.add(pair);
    tickets.push({ id: tickets.length, a, b, points: away, long: false });
  }

  if (tickets.filter((t) => t.long).length === 0) {
    throw new Error(`${spec.id}: no long tickets — the map is too small or too dense`);
  }
  if (tickets.length < spec.cities.length * 0.6) {
    throw new Error(`${spec.id}: only ${tickets.length} tickets for ${spec.cities.length} cities`);
  }

  return {
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    stations: spec.stations,
    cities: spec.cities.map(({ terrain: _terrain, ...rest }) => rest),
    routes,
    tickets
  };
}

/* ----------------------------------------------------------------- maps */

const MERIDIAN: MapSpec = {
  id: "meridian",
  name: "Meridian",
  tagline: "South America · 34 cities · the long spine",
  stations: false,
  routes: 92,
  seed: 0x51d1a,
  water: [
    ["montevideo", "buenosaires"],
    ["punta", "comodoro"]
  ],
  cities: [
    { key: "cartagena", name: "Cartagena", x: 250, y: 80, terrain: "port" },
    { key: "caracas", name: "Caracas", x: 340, y: 70 },
    { key: "georgetown", name: "Georgetown", x: 430, y: 95, terrain: "port" },
    { key: "bogota", name: "Bogotá", x: 245, y: 145, terrain: "mountain" },
    { key: "quito", name: "Quito", x: 200, y: 205, terrain: "mountain" },
    { key: "guayaquil", name: "Guayaquil", x: 165, y: 240, terrain: "port" },
    { key: "iquitos", name: "Iquitos", x: 265, y: 215 },
    { key: "manaus", name: "Manaus", x: 360, y: 190 },
    { key: "belem", name: "Belém", x: 470, y: 175, terrain: "port" },
    { key: "fortaleza", name: "Fortaleza", x: 550, y: 210, terrain: "port" },
    { key: "recife", name: "Recife", x: 570, y: 265, terrain: "port" },
    { key: "salvador", name: "Salvador", x: 535, y: 315, terrain: "port" },
    { key: "lima", name: "Lima", x: 180, y: 320, terrain: "port" },
    { key: "cusco", name: "Cusco", x: 255, y: 330, terrain: "mountain" },
    { key: "arequipa", name: "Arequipa", x: 220, y: 380, terrain: "mountain" },
    { key: "lapaz", name: "La Paz", x: 285, y: 365, terrain: "mountain" },
    { key: "santacruz", name: "Santa Cruz", x: 345, y: 360 },
    { key: "cuiaba", name: "Cuiabá", x: 405, y: 335 },
    { key: "brasilia", name: "Brasília", x: 470, y: 335 },
    { key: "goiania", name: "Goiânia", x: 450, y: 380 },
    { key: "campogrande", name: "Campo Grande", x: 400, y: 400 },
    { key: "riodejaneiro", name: "Rio de Janeiro", x: 505, y: 410, terrain: "port" },
    { key: "saopaulo", name: "São Paulo", x: 460, y: 435 },
    { key: "curitiba", name: "Curitiba", x: 440, y: 480 },
    { key: "asuncion", name: "Asunción", x: 375, y: 455 },
    { key: "portoalegre", name: "Porto Alegre", x: 425, y: 520, terrain: "port" },
    { key: "montevideo", name: "Montevideo", x: 400, y: 570, terrain: "port" },
    { key: "buenosaires", name: "Buenos Aires", x: 350, y: 555, terrain: "port" },
    { key: "rosario", name: "Rosario", x: 340, y: 510 },
    { key: "cordoba", name: "Córdoba", x: 310, y: 480 },
    { key: "mendoza", name: "Mendoza", x: 270, y: 495, terrain: "mountain" },
    { key: "santiago", name: "Santiago", x: 245, y: 505, terrain: "mountain" },
    { key: "bariloche", name: "Bariloche", x: 275, y: 590, terrain: "mountain" },
    { key: "comodoro", name: "Comodoro", x: 305, y: 645, terrain: "port" },
    { key: "punta", name: "Punta Arenas", x: 275, y: 700, terrain: "port" }
  ]
};

const ARCHIPELAGO: MapSpec = {
  id: "archipelago",
  name: "Archipelago",
  tagline: "Japan & Korea · 28 cities · ferries and mountain lines",
  stations: true,
  routes: 62,
  seed: 0xa2c11,
  water: [
    ["busan", "fukuoka"],
    ["hakodate", "aomori"],
    ["matsuyama", "hiroshima"],
    ["kochi", "osaka"],
    ["nagasaki", "kumamoto"]
  ],
  cities: [
    { key: "sapporo", name: "Sapporo", x: 700, y: 90 },
    { key: "hakodate", name: "Hakodate", x: 685, y: 150, terrain: "port" },
    { key: "aomori", name: "Aomori", x: 668, y: 195, terrain: "port" },
    { key: "akita", name: "Akita", x: 628, y: 225 },
    { key: "morioka", name: "Morioka", x: 680, y: 240, terrain: "mountain" },
    { key: "sendai", name: "Sendai", x: 672, y: 285 },
    { key: "niigata", name: "Niigata", x: 610, y: 275, terrain: "port" },
    { key: "nagano", name: "Nagano", x: 615, y: 330, terrain: "mountain" },
    { key: "kanazawa", name: "Kanazawa", x: 560, y: 320 },
    { key: "tokyo", name: "Tokyo", x: 672, y: 350 },
    { key: "yokohama", name: "Yokohama", x: 660, y: 382, terrain: "port" },
    { key: "shizuoka", name: "Shizuoka", x: 622, y: 390 },
    { key: "nagoya", name: "Nagoya", x: 580, y: 372 },
    { key: "kyoto", name: "Kyoto", x: 545, y: 365 },
    { key: "osaka", name: "Osaka", x: 532, y: 395, terrain: "port" },
    { key: "kobe", name: "Kobe", x: 505, y: 390, terrain: "port" },
    { key: "okayama", name: "Okayama", x: 470, y: 385 },
    { key: "hiroshima", name: "Hiroshima", x: 425, y: 395 },
    { key: "matsuyama", name: "Matsuyama", x: 455, y: 445, terrain: "port" },
    { key: "kochi", name: "Kochi", x: 500, y: 455, terrain: "port" },
    { key: "fukuoka", name: "Fukuoka", x: 370, y: 415, terrain: "port" },
    { key: "kumamoto", name: "Kumamoto", x: 378, y: 462 },
    { key: "nagasaki", name: "Nagasaki", x: 330, y: 462, terrain: "port" },
    { key: "kagoshima", name: "Kagoshima", x: 390, y: 512, terrain: "port" },
    { key: "busan", name: "Busan", x: 300, y: 372, terrain: "port" },
    { key: "daegu", name: "Daegu", x: 275, y: 330, terrain: "mountain" },
    { key: "gwangju", name: "Gwangju", x: 240, y: 372 },
    { key: "seoul", name: "Seoul", x: 245, y: 285 }
  ]
};

const NORDIC: MapSpec = {
  id: "nordic",
  name: "Nordic",
  tagline: "The North · 30 cities · long winters, longer routes",
  stations: true,
  routes: 76,
  seed: 0x0dd1e,
  water: [
    ["copenhagen", "malmo"],
    ["stockholm", "turku"],
    ["helsinki", "tallinn"],
    ["gothenburg", "aalborg"],
    ["kiel", "gdansk"]
  ],
  cities: [
    { key: "tromso", name: "Tromsø", x: 520, y: 60, terrain: "mountain" },
    { key: "rovaniemi", name: "Rovaniemi", x: 610, y: 95 },
    { key: "lulea", name: "Luleå", x: 555, y: 140, terrain: "port" },
    { key: "oulu", name: "Oulu", x: 620, y: 160, terrain: "port" },
    { key: "umea", name: "Umeå", x: 530, y: 195, terrain: "port" },
    { key: "trondheim", name: "Trondheim", x: 415, y: 175, terrain: "port" },
    { key: "sundsvall", name: "Sundsvall", x: 505, y: 250 },
    { key: "kuopio", name: "Kuopio", x: 640, y: 230 },
    { key: "tampere", name: "Tampere", x: 610, y: 285 },
    { key: "turku", name: "Turku", x: 578, y: 320, terrain: "port" },
    { key: "helsinki", name: "Helsinki", x: 630, y: 325, terrain: "port" },
    { key: "bergen", name: "Bergen", x: 350, y: 275, terrain: "port" },
    { key: "lillehammer", name: "Lillehammer", x: 425, y: 265, terrain: "mountain" },
    { key: "oslo", name: "Oslo", x: 425, y: 320 },
    { key: "karlstad", name: "Karlstad", x: 470, y: 330 },
    { key: "uppsala", name: "Uppsala", x: 528, y: 305 },
    { key: "stockholm", name: "Stockholm", x: 535, y: 340, terrain: "port" },
    { key: "stavanger", name: "Stavanger", x: 348, y: 335, terrain: "port" },
    { key: "kristiansand", name: "Kristiansand", x: 390, y: 375, terrain: "port" },
    { key: "orebro", name: "Örebro", x: 490, y: 370 },
    { key: "gothenburg", name: "Gothenburg", x: 430, y: 415, terrain: "port" },
    { key: "linkoping", name: "Linköping", x: 505, y: 405 },
    { key: "visby", name: "Visby", x: 560, y: 400, terrain: "port" },
    { key: "kalmar", name: "Kalmar", x: 520, y: 450, terrain: "port" },
    { key: "aalborg", name: "Aalborg", x: 400, y: 460, terrain: "port" },
    { key: "malmo", name: "Malmö", x: 460, y: 490, terrain: "port" },
    { key: "copenhagen", name: "Copenhagen", x: 425, y: 505, terrain: "port" },
    { key: "kiel", name: "Kiel", x: 415, y: 560, terrain: "port" },
    { key: "gdansk", name: "Gdańsk", x: 545, y: 545, terrain: "port" },
    { key: "riga", name: "Riga", x: 630, y: 435, terrain: "port" },
    { key: "tallinn", name: "Tallinn", x: 638, y: 375, terrain: "port" }
  ]
};

function main(): void {
  for (const spec of [MERIDIAN, ARCHIPELAGO, NORDIC]) {
    const map = build(spec);
    writeFileSync(join(OUT, `${spec.id}.json`), `${JSON.stringify(map, null, 2)}\n`);
    const lengths = map.routes.reduce((n, r) => n + (r.len as number), 0);
    console.log(
      `  ${spec.id.padEnd(13)} ${String(map.cities.length).padStart(2)} cities · ` +
        `${String(map.routes.length).padStart(3)} routes · ${lengths} track · ` +
        `${map.tickets.length} tickets`
    );
  }
}

main();
