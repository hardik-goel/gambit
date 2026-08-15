/**
 * Landfall's island: nineteen hexes, fifty-four corners, seventy-two edges.
 *
 * The geometry is derived rather than typed out — hex centres from axial
 * coordinates, corners from the centres, and everything deduplicated by
 * position. That makes the topology provably correct (every corner really is
 * shared by the hexes that touch it) instead of a transcription that might not
 * be.
 */

export const RESOURCES = ["wood", "grain", "wool", "brick", "ore"] as const;
export type Resource = (typeof RESOURCES)[number];
export type Terrain = Resource | "desert";

export const RESOURCE_HEX: Record<Terrain, string> = {
  wood: "#3f6b40",
  grain: "#c9a93f",
  wool: "#7fa05a",
  brick: "#a6592e",
  ore: "#6b6f78",
  desert: "#c2b189"
};

/** The classic 3-4-5-4-3 arrangement, in axial coordinates. */
export const HEX_COORDS: [number, number][] = [
  [0, -2], [1, -2], [2, -2],
  [-1, -1], [0, -1], [1, -1], [2, -1],
  [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0],
  [-2, 1], [-1, 1], [0, 1], [1, 1],
  [-2, 2], [-1, 2], [0, 2]
];

/** Terrain counts, straight from the design. */
export const TERRAIN_BAG: Terrain[] = [
  ...Array<Terrain>(4).fill("wood"),
  ...Array<Terrain>(4).fill("grain"),
  ...Array<Terrain>(4).fill("wool"),
  ...Array<Terrain>(3).fill("brick"),
  ...Array<Terrain>(3).fill("ore"),
  "desert"
];

/** One 2, one 12, two each of 3–6 and 8–11. No sevens: that is the robber. */
export const NUMBER_BAG: number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

/** The spiral the beginner layout lays its numbers along. */
export const NUMBER_SPIRAL = [0, 1, 2, 6, 11, 15, 18, 17, 16, 12, 7, 3, 4, 5, 10, 14, 13, 8, 9];

export type PortKind = "any" | Resource;

export interface Hex {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  corners: number[];
}

export interface Vertex {
  id: number;
  x: number;
  y: number;
  hexes: number[];
  neighbours: number[];
  port: PortKind | null;
}

export interface Edge {
  id: number;
  a: number;
  b: number;
}

const SIZE = 1;
// Corner positions are computed from two directions and meet at floating-point
// values that differ in the sixteenth decimal — and, worse, in the sign of a
// zero. Rounding to a thousandth and normalising -0 away makes the same corner
// hash to the same key however it was reached.
const round3 = (v: number): string => String(Math.round(v * 1000) || 0);

function build(): { hexes: Hex[]; vertices: Vertex[]; edges: Edge[] } {
  const hexes: Hex[] = [];
  const vertexByKey = new Map<string, Vertex>();
  const vertices: Vertex[] = [];

  HEX_COORDS.forEach(([q, r], id) => {
    const x = SIZE * Math.sqrt(3) * (q + r / 2);
    const y = SIZE * 1.5 * r;
    const corners: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      const cx = x + SIZE * Math.cos(angle);
      const cy = y + SIZE * Math.sin(angle);
      const key = `${round3(cx)}:${round3(cy)}`;
      let vertex = vertexByKey.get(key);
      if (!vertex) {
        vertex = { id: vertices.length, x: cx, y: cy, hexes: [], neighbours: [], port: null };
        vertexByKey.set(key, vertex);
        vertices.push(vertex);
      }
      vertex.hexes.push(id);
      corners.push(vertex.id);
    }
    hexes.push({ id, q, r, x, y, corners });
  });

  // Edges: consecutive corners of each hex, deduplicated.
  const edges: Edge[] = [];
  const edgeByKey = new Map<string, Edge>();
  for (const hex of hexes) {
    for (let i = 0; i < 6; i++) {
      const a = hex.corners[i]!;
      const b = hex.corners[(i + 1) % 6]!;
      const key = [a, b].sort((x, y) => x - y).join("-");
      if (edgeByKey.has(key)) continue;
      const edge = { id: edges.length, a, b };
      edgeByKey.set(key, edge);
      edges.push(edge);
      vertices[a]!.neighbours.push(b);
      vertices[b]!.neighbours.push(a);
    }
  }

  // Nine harbours around the coast: four that take any three alike, and one
  // for each resource at two-for-one.
  const coast = vertices
    .filter((v) => v.hexes.length === 1)
    .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  const kinds: PortKind[] = ["any", "wood", "any", "grain", "wool", "any", "brick", "ore", "any"];
  const step = Math.floor(coast.length / kinds.length);
  kinds.forEach((kind, i) => {
    // A harbour occupies two neighbouring coastal corners.
    const first = coast[(i * step) % coast.length]!;
    first.port = kind;
    const partner = coast.find((v) => v.port === null && first.neighbours.includes(v.id));
    if (partner) partner.port = kind;
  });

  return { hexes, vertices, edges };
}

const built = build();
export const HEXES: Hex[] = built.hexes;
export const VERTICES: Vertex[] = built.vertices;
export const EDGES: Edge[] = built.edges;

export const edgeBetween = (a: number, b: number): Edge | undefined =>
  EDGES.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

export const edgesAt = (vertex: number): Edge[] => EDGES.filter((e) => e.a === vertex || e.b === vertex);

/** Build costs, once, where everything can read them. */
export const COSTS = {
  road: { wood: 1, brick: 1 } as Partial<Record<Resource, number>>,
  settlement: { wood: 1, brick: 1, grain: 1, wool: 1 } as Partial<Record<Resource, number>>,
  city: { ore: 3, grain: 2 } as Partial<Record<Resource, number>>,
  development: { ore: 1, wool: 1, grain: 1 } as Partial<Record<Resource, number>>
};

export type DevCard = "soldier" | "victory" | "roads" | "monopoly" | "plenty";

/** Twenty-five development cards. */
export const DEV_BAG: DevCard[] = [
  ...Array<DevCard>(14).fill("soldier"),
  ...Array<DevCard>(5).fill("victory"),
  ...Array<DevCard>(2).fill("roads"),
  ...Array<DevCard>(2).fill("monopoly"),
  ...Array<DevCard>(2).fill("plenty")
];

export const DEV_NAMES: Record<DevCard, string> = {
  soldier: "Soldier",
  victory: "Charter",
  roads: "Road Building",
  monopoly: "Monopoly",
  plenty: "Year of Plenty"
};
