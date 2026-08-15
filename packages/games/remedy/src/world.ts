/**
 * Remedy's world: forty-eight cities in four zones, one affliction per zone.
 *
 * The names and the layout are original. The road network is generated from the
 * layout with a fixed seed — nearest neighbours within a zone, a handful of
 * crossings between them, then a repair pass that guarantees one connected
 * world. Deterministic, so every table plays the same map.
 */
import { Rng } from "@gambit/sdk";

export const ZONES = ["amber", "cobalt", "verdant", "rust"] as const;
export type Zone = (typeof ZONES)[number];

export const ZONE_HEX: Record<Zone, string> = {
  amber: "#c9973f",
  cobalt: "#3c6ea8",
  verdant: "#4d8a52",
  rust: "#a6592e"
};

export const ZONE_NAMES: Record<Zone, string> = {
  amber: "Amber Fever",
  cobalt: "Cobalt Chill",
  verdant: "Verdant Blight",
  rust: "Rust Lung"
};

const NAMES: Record<Zone, string[]> = {
  amber: [
    "Halcyon", "Tumbrel", "Verrick", "Solace Bay", "Kestrel", "Marrow",
    "Windlass", "Corvid", "Pell", "Ashen Ford", "Quarry Hill", "Sable Cross"
  ],
  cobalt: [
    "Nimbus", "Ostrich Bay", "Larkspur", "Thorne", "Vantage", "Pike Hollow",
    "Aster", "Bell Harbour", "Cygnet", "Fen Marsh", "Rill", "Gantry"
  ],
  verdant: [
    "Palmyra", "Sunder", "Kite Reach", "Loam", "Bramble", "Ferrous",
    "Mistral", "Vale End", "Orchard", "Tidings", "Hollowbrook", "Green Span"
  ],
  rust: [
    "Cinder", "Anvil", "Kiln", "Slate Harbour", "Ember Reach", "Foundry",
    "Basalt", "Torrid", "Scoria", "Pyre", "Clinker", "Forge Point"
  ]
};

export interface City {
  id: number;
  name: string;
  zone: Zone;
  x: number;
  y: number;
  links: number[];
}

const QUADRANT: Record<Zone, [number, number]> = {
  amber: [90, 70],
  cobalt: [520, 70],
  verdant: [90, 360],
  rust: [520, 360]
};

function build(): { cities: City[]; hub: number } {
  const rng = new Rng("gambit-remedy-world-v1");
  const cities: City[] = [];

  ZONES.forEach((zone) => {
    const [ox, oy] = QUADRANT[zone];
    NAMES[zone].forEach((name, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      cities.push({
        id: cities.length,
        name,
        zone,
        x: Math.round(ox + col * 110 + (rng.raw() - 0.5) * 46),
        y: Math.round(oy + row * 105 + (rng.raw() - 0.5) * 46),
        links: []
      });
    });
  });

  const dist = (a: City, b: City) => Math.hypot(a.x - b.x, a.y - b.y);
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!cities[a]!.links.includes(b)) cities[a]!.links.push(b);
    if (!cities[b]!.links.includes(a)) cities[b]!.links.push(a);
  };

  // Roads within a zone: each city to its nearest few.
  for (const city of cities) {
    const near = cities
      .filter((c) => c.id !== city.id && c.zone === city.zone)
      .sort((p, q) => dist(city, p) - dist(city, q))
      .slice(0, 2 + rng.int(2));
    for (const other of near) link(city.id, other.id);
  }

  // Crossings between zones: the shortest few hops over each border.
  for (let i = 0; i < ZONES.length; i++) {
    for (let j = i + 1; j < ZONES.length; j++) {
      const a = cities.filter((c) => c.zone === ZONES[i]);
      const b = cities.filter((c) => c.zone === ZONES[j]);
      const pairs = a
        .flatMap((x) => b.map((y) => ({ x, y, d: dist(x, y) })))
        .sort((p, q) => p.d - q.d)
        .slice(0, 3);
      for (const pair of pairs) link(pair.x.id, pair.y.id);
    }
  }

  // Repair: stitch any stranded pocket to the nearest city in the main body.
  for (let pass = 0; pass < 8; pass++) {
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of cities[id]!.links) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    if (seen.size === cities.length) break;
    const stranded = cities.filter((c) => !seen.has(c.id));
    for (const city of stranded) {
      const nearest = cities
        .filter((c) => seen.has(c.id))
        .sort((p, q) => dist(city, p) - dist(city, q))[0];
      if (nearest) link(city.id, nearest.id);
    }
  }

  // The hub is the city nearest the middle of the map — where the first
  // laboratory stands and where every plan tends to start.
  const cx = cities.reduce((n, c) => n + c.x, 0) / cities.length;
  const cy = cities.reduce((n, c) => n + c.y, 0) / cities.length;
  const hub = cities
    .slice()
    .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0]!.id;

  return { cities, hub };
}

const built = build();
export const CITIES: City[] = built.cities;
export const HUB: number = built.hub;
export const cityById = (id: number): City => CITIES[id]!;
export const zoneOf = (id: number): Zone => CITIES[id]!.zone;

export const CUBES_PER_ZONE = 24;
export const MAX_LABS = 6;
export const OUTBREAK_LIMIT = 8;
export const INFECTION_RATES = [2, 2, 2, 3, 3, 4, 4];

export type Role = "medic" | "scientist" | "courier" | "engineer" | "analyst";

export const ROLE_NAMES: Record<Role, string> = {
  medic: "Medic",
  scientist: "Scientist",
  courier: "Courier",
  engineer: "Engineer",
  analyst: "Analyst"
};

export const ROLE_POWERS: Record<Role, string> = {
  medic: "Treating removes every cube of a colour at once, and cured colours clear themselves wherever you go.",
  scientist: "Four cards of a colour are enough for a cure.",
  courier: "Move another player's pawn as if it were your own, with their say-so — or any pawn between laboratories.",
  engineer: "Build a laboratory without spending a card, and once a turn fly from a laboratory to anywhere for any card.",
  analyst: "Hand over any city card when you share knowledge, not only the one you are standing on."
};

export const HAND_LIMIT = 7;

/** Player-deck size per table, and hands dealt. */
export const STARTING_HAND: Record<number, number> = { 2: 4, 3: 3, 4: 2, 5: 2 };

export const EPIDEMICS: Record<string, number> = { introductory: 4, standard: 5, heroic: 6 };
