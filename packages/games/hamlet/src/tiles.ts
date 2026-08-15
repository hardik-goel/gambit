/**
 * Hamlet's tile set: 72 tiles, one of which starts the map.
 *
 * A tile is four edges — road, keep or field — plus the internal connections
 * that say which of those edges are the same feature. A road group with one
 * edge is a dead end at the tile's centre; a group with two is a road passing
 * through. Shrines and banners are flags on the tile itself.
 *
 * The distribution mirrors the frequency curve that makes this kind of game
 * work — plenty of plain road, fewer big keeps, a handful of shrines — while
 * the tiles themselves are ours.
 */

export type EdgeType = "road" | "keep" | "field";
export const R: EdgeType = "road";
export const K: EdgeType = "keep";
export const F: EdgeType = "field";

/** Edge order is north, east, south, west. */
export type Edges = [EdgeType, EdgeType, EdgeType, EdgeType];

export interface TileDef {
  id: string;
  edges: Edges;
  /** Edge indices joined into one keep. */
  keeps: number[][];
  /** Edge indices joined into one road; a single index is a dead end. */
  roads: number[][];
  shrine: boolean;
  banner: boolean;
  count: number;
  start?: boolean;
}

const def = (
  id: string,
  edges: Edges,
  opts: Partial<Omit<TileDef, "id" | "edges">> = {}
): TileDef => ({
  id,
  edges,
  keeps: opts.keeps ?? [],
  roads: opts.roads ?? [],
  shrine: opts.shrine ?? false,
  banner: opts.banner ?? false,
  count: opts.count ?? 1,
  ...(opts.start ? { start: true } : {})
});

export const TILE_DEFS: TileDef[] = [
  // The opening tile: a keep to the north, a road running east to west.
  def("start", [K, R, F, R], { keeps: [[0]], roads: [[1, 3]], count: 1, start: true }),

  // Keeps
  def("keep-full", [K, K, K, K], { keeps: [[0, 1, 2, 3]], banner: true, count: 1 }),
  def("keep-three", [K, K, K, F], { keeps: [[0, 1, 2]], count: 3 }),
  def("keep-three-banner", [K, K, K, F], { keeps: [[0, 1, 2]], banner: true, count: 1 }),
  def("keep-three-road", [K, K, K, R], { keeps: [[0, 1, 2]], roads: [[3]], count: 3 }),
  def("keep-three-road-banner", [K, K, K, R], { keeps: [[0, 1, 2]], roads: [[3]], banner: true, count: 2 }),
  def("keep-corner", [K, K, F, F], { keeps: [[0, 1]], count: 3 }),
  def("keep-corner-banner", [K, K, F, F], { keeps: [[0, 1]], banner: true, count: 2 }),
  def("keep-facing", [K, F, K, F], { keeps: [[0], [2]], count: 3 }),
  def("keep-through", [K, F, K, F], { keeps: [[0, 2]], count: 1 }),
  def("keep-edge", [K, F, F, F], { keeps: [[0]], count: 5 }),
  def("keep-edge-road", [K, F, R, F], { keeps: [[0]], roads: [[2]], count: 3 }),
  def("keep-edge-bend-left", [K, R, R, F], { keeps: [[0]], roads: [[1, 2]], count: 3 }),
  def("keep-edge-bend-right", [K, F, R, R], { keeps: [[0]], roads: [[2, 3]], count: 3 }),
  def("keep-edge-junction", [K, R, R, R], { keeps: [[0]], roads: [[1], [2], [3]], count: 3 }),
  def("keep-corner-road", [K, K, R, R], { keeps: [[0, 1]], roads: [[2, 3]], count: 3 }),
  def("keep-corner-road-banner", [K, K, R, R], { keeps: [[0, 1]], roads: [[2, 3]], banner: true, count: 2 }),

  // Roads
  def("road-straight", [F, R, F, R], { roads: [[1, 3]], count: 8 }),
  def("road-bend", [F, R, R, F], { roads: [[1, 2]], count: 9 }),
  def("road-junction", [F, R, R, R], { roads: [[1], [2], [3]], count: 4 }),
  def("road-crossroads", [R, R, R, R], { roads: [[0], [1], [2], [3]], count: 1 }),

  // Shrines and open country
  def("shrine", [F, F, F, F], { shrine: true, count: 4 }),
  def("shrine-road", [F, F, R, F], { roads: [[2]], shrine: true, count: 2 }),
  def("field", [F, F, F, F], { count: 2 })
];

export const TOTAL_TILES = TILE_DEFS.reduce((n, t) => n + t.count, 0);
export const START_TILE = TILE_DEFS.find((t) => t.start)!;

/** The bag: every tile except the one that starts the map. */
export function tileBag(): string[] {
  const bag: string[] = [];
  for (const tile of TILE_DEFS) {
    const copies = tile.start ? tile.count - 1 : tile.count;
    for (let i = 0; i < copies; i++) bag.push(tile.id);
  }
  return bag;
}

export const tileById = (id: string): TileDef => TILE_DEFS.find((t) => t.id === id)!;

/** Edge type on a rotated tile, in board terms. Rotation is quarter turns. */
export function edgeAt(tile: TileDef, rotation: number, side: number): EdgeType {
  return tile.edges[(side - rotation + 8) % 4]!;
}

/** The feature group a rotated tile's board-side belongs to, if any. */
export function groupAt(
  tile: TileDef,
  rotation: number,
  side: number,
  kind: "keeps" | "roads"
): number | null {
  const local = (side - rotation + 8) % 4;
  const groups = tile[kind];
  for (let i = 0; i < groups.length; i++) if (groups[i]!.includes(local)) return i;
  return null;
}

/** Board-side indices belonging to a group, after rotation. */
export function sidesOfGroup(
  tile: TileDef,
  rotation: number,
  kind: "keeps" | "roads",
  group: number
): number[] {
  return (tile[kind][group] ?? []).map((local) => (local + rotation) % 4);
}

/** Field edges, treated as one region per tile. */
export function fieldSides(tile: TileDef, rotation: number): number[] {
  const sides: number[] = [];
  for (let side = 0; side < 4; side++) if (edgeAt(tile, rotation, side) === "field") sides.push(side);
  return sides;
}

export const OPPOSITE = [2, 3, 0, 1];
export const DELTA: [number, number][] = [
  [0, -1], // north
  [1, 0],  // east
  [0, 1],  // south
  [-1, 0]  // west
];
