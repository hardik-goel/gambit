/**
 * Hamlet — lay the land, tile by tile.
 *
 * Features (roads, keeps, fields) are tracked with union-find over
 * "tile + local group" keys, which is what makes completion detection cheap:
 * a feature is finished the moment it has no open edges left.
 */
import {
  clone,
  err,
  ok,
  rankScores,
  Rng,
  UnionFind,
  type BaseState,
  type FinalScore,
  type GameEvent,
  type Result,
  type Seat,
  type SeatId
} from "@gambit/sdk";
import { z } from "zod";
import {
  DELTA,
  OPPOSITE,
  START_TILE,
  edgeAt,
  fieldSides,
  groupAt,
  sidesOfGroup,
  tileBag,
  tileById,
  type TileDef
} from "./tiles";

export const configSchema = z.object({
  /** Fields pay out at the end; turning them off makes a shorter, sharper game. */
  fields: z.boolean().default(true),
  meeples: z.enum(["7", "5"]).default("7")
});

export type HamletConfig = z.infer<typeof configSchema>;

export type FeatureKind = "road" | "keep" | "field" | "shrine";

export interface PlacedTile {
  id: string;
  rotation: number;
  x: number;
  y: number;
  /** Seat that placed it, for the map's ownership tint. */
  by: SeatId;
}

export interface Meeple {
  seat: SeatId;
  x: number;
  y: number;
  kind: FeatureKind;
  /** Group index within the tile; ignored for shrines. */
  group: number;
}

export type HamletMove =
  | { kind: "place"; x: number; y: number; rotation: number; meeple?: { kind: FeatureKind; group: number } }
  | { kind: "discard" };

export interface HamletState extends BaseState {
  bag: string[];
  /** The tile in hand, waiting to be placed. */
  drawn: string | null;
  tiles: Record<string, PlacedTile>;
  meeples: Meeple[];
  meeplesLeft: Record<SeatId, number>;
  scores: Record<SeatId, number>;
  names: Record<SeatId, string>;
  turn: SeatId;
  fieldsOn: boolean;
  finished: boolean;
}

const key = (x: number, y: number): string => `${x},${y}`;
const featureKey = (x: number, y: number, kind: FeatureKind, group: number): string =>
  `${x},${y}:${kind}:${kind === "shrine" ? 0 : group}`;

export function createState(config: HamletConfig, seats: Seat[], seed: string): HamletState {
  const rng = new Rng(seed);
  const meeples = Number(config.meeples);
  const state: HamletState = {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    bag: rng.shuffle(tileBag()),
    drawn: null,
    tiles: { [key(0, 0)]: { id: START_TILE.id, rotation: 0, x: 0, y: 0, by: 0 } },
    meeples: [],
    meeplesLeft: {},
    scores: {},
    names: {},
    turn: seats[0]!.id,
    fieldsOn: config.fields,
    finished: false
  };
  state.rng = rng.serialize();
  for (const s of seats) {
    state.meeplesLeft[s.id] = meeples;
    state.scores[s.id] = 0;
    state.names[s.id] = s.name;
  }
  state.drawn = state.bag.shift() ?? null;
  return state;
}

export function currentSeats(state: HamletState): SeatId[] {
  return state.finished ? [] : [state.turn];
}

/* ------------------------------------------------------------- placement */

export function canPlace(state: HamletState, id: string, x: number, y: number, rotation: number): boolean {
  if (state.tiles[key(x, y)]) return false;
  const tile = tileById(id);
  let touches = false;
  for (let side = 0; side < 4; side++) {
    const [dx, dy] = DELTA[side]!;
    const neighbour = state.tiles[key(x + dx, y + dy)];
    if (!neighbour) continue;
    touches = true;
    const theirs = edgeAt(tileById(neighbour.id), neighbour.rotation, OPPOSITE[side]!);
    if (edgeAt(tile, rotation, side) !== theirs) return false;
  }
  return touches;
}

/** Every empty square that touches the map. */
export function frontier(state: HamletState): { x: number; y: number }[] {
  const spots = new Map<string, { x: number; y: number }>();
  for (const tile of Object.values(state.tiles)) {
    for (const [dx, dy] of DELTA) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (!state.tiles[key(x, y)]) spots.set(key(x, y), { x, y });
    }
  }
  return [...spots.values()];
}

/** Features on a just-placed tile that carry no meeple yet. */
export function openFeatures(
  state: HamletState,
  x: number,
  y: number,
  id: string,
  rotation: number
): { kind: FeatureKind; group: number }[] {
  const tile = tileById(id);
  const out: { kind: FeatureKind; group: number }[] = [];
  // The tile is not on the board yet, so ask the question of a board that has
  // it. One union-find for all four features, not one each — this runs for
  // every candidate placement and rotation.
  const probe: HamletState = {
    ...state,
    tiles: { ...state.tiles, [key(x, y)]: { id, rotation, x, y, by: state.turn } }
  };
  const uf = buildRegions(probe);
  const meepleRoots = new Set(probe.meeples.map((m) => uf.find(featureKey(m.x, m.y, m.kind, m.group))));
  const claimed = (kind: FeatureKind, group: number): boolean =>
    meepleRoots.has(uf.find(featureKey(x, y, kind, group)));

  tile.keeps.forEach((_, group) => {
    if (!claimed("keep", group)) out.push({ kind: "keep", group });
  });
  tile.roads.forEach((_, group) => {
    if (!claimed("road", group)) out.push({ kind: "road", group });
  });
  if (tile.shrine && !claimed("shrine", 0)) out.push({ kind: "shrine", group: 0 });
  if (state.fieldsOn && fieldSides(tile, rotation).length > 0 && !claimed("field", 0)) {
    out.push({ kind: "field", group: 0 });
  }
  return out;
}

export function legalMoves(state: HamletState, seat: SeatId): HamletMove[] {
  if (state.finished || state.turn !== seat) return [];
  if (!state.drawn) return [];

  const moves: HamletMove[] = [];
  const spots = frontier(state);
  let placeable = false;

  for (const spot of spots) {
    for (let rotation = 0; rotation < 4; rotation++) {
      if (!canPlace(state, state.drawn, spot.x, spot.y, rotation)) continue;
      placeable = true;
      moves.push({ kind: "place", x: spot.x, y: spot.y, rotation });
      if ((state.meeplesLeft[seat] ?? 0) > 0) {
        for (const feature of openFeatures(state, spot.x, spot.y, state.drawn, rotation)) {
          moves.push({ kind: "place", x: spot.x, y: spot.y, rotation, meeple: feature });
        }
      }
    }
  }

  // A tile that fits nowhere is discarded and another drawn.
  if (!placeable) moves.push({ kind: "discard" });
  return moves;
}

/* --------------------------------------------------------------- regions */

/** Union-find over every feature on the board, rebuilt on demand. */
export function buildRegions(state: HamletState): UnionFind {
  const uf = new UnionFind();
  for (const placed of Object.values(state.tiles)) {
    const tile = tileById(placed.id);
    tile.keeps.forEach((_, g) => uf.add(featureKey(placed.x, placed.y, "keep", g)));
    tile.roads.forEach((_, g) => uf.add(featureKey(placed.x, placed.y, "road", g)));
    if (tile.shrine) uf.add(featureKey(placed.x, placed.y, "shrine", 0));
    if (fieldSides(tile, placed.rotation).length) uf.add(featureKey(placed.x, placed.y, "field", 0));
  }

  for (const placed of Object.values(state.tiles)) {
    const tile = tileById(placed.id);
    for (let side = 0; side < 4; side++) {
      const [dx, dy] = DELTA[side]!;
      const neighbour = state.tiles[key(placed.x + dx, placed.y + dy)];
      if (!neighbour) continue;
      const theirs = tileById(neighbour.id);
      const type = edgeAt(tile, placed.rotation, side);
      if (type === "field") {
        uf.union(
          featureKey(placed.x, placed.y, "field", 0),
          featureKey(neighbour.x, neighbour.y, "field", 0)
        );
        continue;
      }
      const kind = type === "keep" ? "keeps" : "roads";
      const mine = groupAt(tile, placed.rotation, side, kind);
      const yours = groupAt(theirs, neighbour.rotation, OPPOSITE[side]!, kind);
      if (mine === null || yours === null) continue;
      uf.union(
        featureKey(placed.x, placed.y, type === "keep" ? "keep" : "road", mine),
        featureKey(neighbour.x, neighbour.y, type === "keep" ? "keep" : "road", yours)
      );
    }
  }
  return uf;
}

interface FeatureInfo {
  kind: FeatureKind;
  members: { x: number; y: number; group: number }[];
  tiles: Set<string>;
  banners: number;
  openEdges: number;
  complete: boolean;
}

export function featureAt(state: HamletState, x: number, y: number, kind: FeatureKind, group: number): FeatureInfo {
  const uf = buildRegions(state);
  const root = uf.find(featureKey(x, y, kind, group));
  const members: FeatureInfo["members"] = [];
  const tiles = new Set<string>();
  let banners = 0;
  let openEdges = 0;

  for (const placed of Object.values(state.tiles)) {
    const tile = tileById(placed.id);
    const groups: number[] =
      kind === "keep"
        ? tile.keeps.map((_, i) => i)
        : kind === "road"
          ? tile.roads.map((_, i) => i)
          : kind === "shrine"
            ? tile.shrine
              ? [0]
              : []
            : fieldSides(tile, placed.rotation).length
              ? [0]
              : [];

    for (const g of groups) {
      if (uf.find(featureKey(placed.x, placed.y, kind, g)) !== root) continue;
      members.push({ x: placed.x, y: placed.y, group: g });
      tiles.add(key(placed.x, placed.y));
      if (kind === "keep" && tile.banner) banners++;

      const sides =
        kind === "keep" || kind === "road"
          ? sidesOfGroup(tile, placed.rotation, kind === "keep" ? "keeps" : "roads", g)
          : kind === "field"
            ? fieldSides(tile, placed.rotation)
            : [];
      for (const side of sides) {
        const [dx, dy] = DELTA[side]!;
        if (!state.tiles[key(placed.x + dx, placed.y + dy)]) openEdges++;
      }
    }
  }

  let complete = openEdges === 0 && members.length > 0;
  if (kind === "shrine") {
    complete = neighbourCount(state, x, y) === 8;
  }
  if (kind === "field") complete = false; // fields only pay at the end

  return { kind, members, tiles, banners, openEdges, complete };
}

function neighbourCount(state: HamletState, x: number, y: number): number {
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (state.tiles[key(x + dx, y + dy)]) n++;
    }
  }
  return n;
}

function scoreOf(kind: FeatureKind, info: FeatureInfo, state: HamletState, complete: boolean, x?: number, y?: number): number {
  const tiles = info.tiles.size;
  if (kind === "road") return tiles * 1;
  if (kind === "keep") return complete ? tiles * 2 + info.banners * 2 : tiles * 1 + info.banners * 1;
  if (kind === "shrine") {
    const around = x !== undefined && y !== undefined ? neighbourCount(state, x, y) : 8;
    return complete ? 9 : 1 + around;
  }
  return 0;
}

/** Majority takes it; a tie pays everyone in the tie in full. */
function majority(meeples: Meeple[]): SeatId[] {
  if (meeples.length === 0) return [];
  const counts = new Map<SeatId, number>();
  for (const m of meeples) counts.set(m.seat, (counts.get(m.seat) ?? 0) + 1);
  const best = Math.max(...counts.values());
  return [...counts.entries()].filter(([, n]) => n === best).map(([seat]) => seat);
}

/* --------------------------------------------------------------- applying */

export function applyMove(
  state: HamletState,
  seat: SeatId,
  move: HamletMove
): Result<{ state: HamletState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  if (state.turn !== seat) return err("not-your-turn", "Wait for your turn.");
  const kind = (move as { kind?: string })?.kind;
  if (kind !== "place" && kind !== "discard") {
    return err("unknown-move", "That isn't a move this game understands.");
  }
  if (!state.drawn) return err("no-tile", "There's no tile to place.");

  const next = clone(state);
  const events: GameEvent[] = [];

  if (kind === "discard") {
    if (legalMoves(state, seat).some((m) => m.kind === "place")) {
      return err("can-place", "That tile does fit somewhere.");
    }
    next.drawn = next.bag.shift() ?? null;
    next.ply++;
    events.push({ type: "discard", seat, text: "That tile fits nowhere — drawing another.", sfx: "cardSlip" });
    if (!next.drawn) finish(next, events);
    return ok({ state: next, events });
  }

  const { x, y, rotation, meeple } = move as Extract<HamletMove, { kind: "place" }>;
  if (typeof x !== "number" || typeof y !== "number" || typeof rotation !== "number") {
    return err("bad-move", "That isn't a place on the map.");
  }
  if (state.tiles[key(x, y)]) return err("occupied", "There's already a tile there.");
  if (!canPlace(state, state.drawn, x, y, rotation)) {
    return err("no-match", "The edges don't line up there.");
  }

  const placedId = state.drawn;
  next.tiles[key(x, y)] = { id: placedId, rotation, x, y, by: seat };
  next.drawn = null;
  next.ply++;
  events.push({
    type: "tile",
    seat,
    text: `${next.names[seat]} lays a tile.`,
    data: { x, y, rotation, id: placedId },
    sfx: "tileSnap"
  });

  if (meeple) {
    if ((next.meeplesLeft[seat] ?? 0) <= 0) return err("no-meeples", "All your meeples are out on the map.");
    const available = openFeatures(state, x, y, placedId, rotation);
    if (!available.some((f) => f.kind === meeple.kind && f.group === meeple.group)) {
      return err("claimed", "Someone is already on that feature.");
    }
    next.meeples.push({ seat, x, y, kind: meeple.kind, group: meeple.group });
    next.meeplesLeft[seat]!--;
    events.push({
      type: "meeple",
      seat,
      text: `${next.names[seat]} claims a ${meeple.kind}.`,
      data: { x, y, ...meeple },
      sfx: "meeple"
    });
  }

  // Anything the new tile finished pays out at once, and frees its meeples.
  scoreCompleted(next, x, y, events);

  if (!next.bag.length) {
    finish(next, events);
    return ok({ state: next, events });
  }

  next.drawn = next.bag.shift() ?? null;
  next.turn = (seat + 1) % next.seatCount;
  return ok({ state: next, events });
}

function scoreCompleted(state: HamletState, x: number, y: number, events: GameEvent[]): void {
  const placed = state.tiles[key(x, y)]!;
  const tile = tileById(placed.id);
  const candidates: { kind: FeatureKind; group: number; x: number; y: number }[] = [];

  tile.keeps.forEach((_, g) => candidates.push({ kind: "keep", group: g, x, y }));
  tile.roads.forEach((_, g) => candidates.push({ kind: "road", group: g, x, y }));
  if (tile.shrine) candidates.push({ kind: "shrine", group: 0, x, y });

  // A new tile can also complete a neighbouring shrine.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const other = state.tiles[key(x + dx, y + dy)];
      if (other && tileById(other.id).shrine) {
        candidates.push({ kind: "shrine", group: 0, x: other.x, y: other.y });
      }
    }
  }

  const uf = buildRegions(state);
  const paid = new Set<string>();

  for (const candidate of candidates) {
    const info = featureAt(state, candidate.x, candidate.y, candidate.kind, candidate.group);
    if (!info.complete) continue;
    const root = uf.find(featureKey(candidate.x, candidate.y, candidate.kind, candidate.group));
    if (paid.has(root)) continue;
    paid.add(root);

    const onIt = state.meeples.filter(
      (m) => m.kind === candidate.kind && uf.find(featureKey(m.x, m.y, m.kind, m.group)) === root
    );
    const winners = majority(onIt);
    const points = scoreOf(candidate.kind, info, state, true, candidate.x, candidate.y);

    for (const seat of winners) {
      state.scores[seat] = (state.scores[seat] ?? 0) + points;
      events.push({
        type: "score",
        seat,
        text: `${state.names[seat]} scores ${points} for a completed ${candidate.kind}.`,
        data: { points, kind: candidate.kind },
        sfx: "claim"
      });
    }
    // Meeples come home whether they scored or not.
    for (const m of onIt) state.meeplesLeft[m.seat] = (state.meeplesLeft[m.seat] ?? 0) + 1;
    state.meeples = state.meeples.filter((m) => !onIt.includes(m));
  }
}

function finish(state: HamletState, events: GameEvent[]): void {
  state.finished = true;
  const uf = buildRegions(state);
  const paid = new Set<string>();

  for (const meeple of state.meeples) {
    const root = uf.find(featureKey(meeple.x, meeple.y, meeple.kind, meeple.group));
    if (paid.has(root)) continue;
    paid.add(root);
    const info = featureAt(state, meeple.x, meeple.y, meeple.kind, meeple.group);
    const onIt = state.meeples.filter(
      (m) => m.kind === meeple.kind && uf.find(featureKey(m.x, m.y, m.kind, m.group)) === root
    );
    const winners = majority(onIt);

    let points = 0;
    if (meeple.kind === "field") {
      points = state.fieldsOn ? completedKeepsTouching(state, uf, root) * 3 : 0;
    } else {
      points = scoreOf(meeple.kind, info, state, false, meeple.x, meeple.y);
    }
    for (const seat of winners) {
      state.scores[seat] = (state.scores[seat] ?? 0) + points;
      if (points > 0) {
        events.push({
          type: "final-score",
          seat,
          text: `${state.names[seat]} scores ${points} for an unfinished ${meeple.kind}.`,
          data: { points, kind: meeple.kind }
        });
      }
    }
  }
  events.push({ type: "game-end", text: "The last tile is laid.", sfx: "win" });
}

/** Completed keeps that a field region touches — three points each. */
function completedKeepsTouching(state: HamletState, uf: UnionFind, fieldRoot: string): number {
  const keepRoots = new Set<string>();
  for (const placed of Object.values(state.tiles)) {
    const tile = tileById(placed.id);
    if (fieldSides(tile, placed.rotation).length === 0) continue;
    if (uf.find(featureKey(placed.x, placed.y, "field", 0)) !== fieldRoot) continue;
    // A field touches every keep that shares its tile.
    tile.keeps.forEach((_, g) => {
      const info = featureAt(state, placed.x, placed.y, "keep", g);
      if (info.complete) keepRoots.add(uf.find(featureKey(placed.x, placed.y, "keep", g)));
    });
  }
  return keepRoots.size;
}

export function isTerminal(state: HamletState): boolean {
  return state.finished;
}

export function score(state: HamletState): FinalScore[] {
  const entries = Object.keys(state.scores)
    .map(Number)
    .map((seat) => ({
      seat,
      total: state.scores[seat] ?? 0,
      lines: [
        { label: "Features", value: state.scores[seat] ?? 0 },
        { label: "Meeples still out", value: 0 }
      ]
    }));
  // A tie goes to whoever has more meeples back in hand — more finished work.
  return rankScores(entries, (a, b) => (state.meeplesLeft[b] ?? 0) - (state.meeplesLeft[a] ?? 0));
}

export interface HamletView {
  tiles: Record<string, PlacedTile>;
  drawn: string | null;
  bagCount: number;
  meeples: Meeple[];
  meeplesLeft: Record<SeatId, number>;
  scores: Record<SeatId, number>;
  names: Record<SeatId, string>;
  turn: SeatId;
  finished: boolean;
  seat: SeatId | "spectator";
  /** Where the drawn tile may go, so the board can light the map. */
  spots: { x: number; y: number; rotations: number[] }[];
}

/**
 * Hamlet is played face up — the only hidden thing is the order of the bag,
 * and the tile you have not drawn yet.
 */
export function redactStateFor(state: HamletState, viewer: SeatId | "spectator"): HamletView {
  const spots: HamletView["spots"] = [];
  if (state.drawn && !state.finished) {
    for (const spot of frontier(state)) {
      const rotations = [0, 1, 2, 3].filter((r) => canPlace(state, state.drawn!, spot.x, spot.y, r));
      if (rotations.length) spots.push({ ...spot, rotations });
    }
  }
  return {
    tiles: clone(state.tiles),
    drawn: state.drawn,
    bagCount: state.bag.length,
    meeples: state.meeples.map((m) => ({ ...m })),
    meeplesLeft: { ...state.meeplesLeft },
    scores: { ...state.scores },
    names: { ...state.names },
    turn: state.turn,
    finished: state.finished,
    seat: viewer,
    spots
  };
}

export function describeMove(_state: HamletState, _seat: SeatId, move: HamletMove): string {
  if (move.kind === "discard") return "discards an unplaceable tile";
  return `lays a tile at ${move.x},${move.y}${move.meeple ? ` and claims the ${move.meeple.kind}` : ""}`;
}

/** Tiles and meeples are conserved; nothing is placed off the edge of reason. */
export function invariants(state: HamletState): string | void {
  const placed = Object.keys(state.tiles).length;
  const inBag = state.bag.length + (state.drawn ? 1 : 0);
  // The start tile is on the board from the beginning.
  if (placed + inBag > 72 + 1) return `tile count is ${placed + inBag}`;

  for (const seat of Object.keys(state.meeplesLeft).map(Number)) {
    const out = state.meeples.filter((m) => m.seat === seat).length;
    const total = (state.meeplesLeft[seat] ?? 0) + out;
    if (total > 7) return `seat ${seat} has ${total} meeples`;
    if ((state.meeplesLeft[seat] ?? 0) < 0) return "a player has negative meeples";
  }
  for (const m of state.meeples) {
    if (!state.tiles[key(m.x, m.y)]) return "a meeple is standing on nothing";
  }
  return undefined;
}

export type { TileDef };
