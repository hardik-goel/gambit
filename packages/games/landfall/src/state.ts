/**
 * Landfall — settle, trade, out-build the island.
 *
 * Two things here are worth reading for their own sake. The seven, which is an
 * interrupt that hits several seats at once: everybody over the hand limit
 * discards before the roller may continue. And trading, which is an offer that
 * sits on the table while the other players say yes or no — the first thing in
 * Gambit where a move is a conversation rather than an action.
 */
import {
  clone,
  err,
  ok,
  pendingId,
  rankScores,
  Rng,
  type BaseState,
  type FinalScore,
  type GameEvent,
  type Result,
  type Seat,
  type SeatId
} from "@gambit/sdk";
import { z } from "zod";
import {
  COSTS,
  DEV_BAG,
  EDGES,
  HEXES,
  NUMBER_BAG,
  NUMBER_SPIRAL,
  RESOURCES,
  TERRAIN_BAG,
  VERTICES,
  edgesAt,
  type DevCard,
  type PortKind,
  type Resource,
  type Terrain
} from "./island";

export const configSchema = z.object({
  layout: z.enum(["variable", "beginner"]).default("variable"),
  target: z.enum(["10", "8", "12"]).default("10"),
  /** Turn player trading off for a faster, colder game. */
  trading: z.boolean().default(true)
});

export type LandfallConfig = z.infer<typeof configSchema>;

export type Hand = Record<Resource, number>;

export type LandfallMove =
  | { kind: "place-settlement"; vertex: number }
  | { kind: "place-road"; edge: number }
  | { kind: "roll" }
  | { kind: "discard"; give: Partial<Hand> }
  | { kind: "move-robber"; hex: number; steal: SeatId | null }
  | { kind: "build-road"; edge: number }
  | { kind: "build-settlement"; vertex: number }
  | { kind: "build-city"; vertex: number }
  | { kind: "buy-dev" }
  | { kind: "play-soldier"; hex: number; steal: SeatId | null }
  | { kind: "play-roads"; edges: number[] }
  | { kind: "play-monopoly"; resource: Resource }
  | { kind: "play-plenty"; resources: Resource[] }
  | { kind: "bank-trade"; give: Resource; get: Resource }
  | { kind: "offer"; give: Partial<Hand>; want: Partial<Hand> }
  | { kind: "respond"; accept: boolean }
  | { kind: "close-offer"; with: SeatId | null }
  | { kind: "end-turn" };

export interface Building {
  seat: SeatId;
  type: "settlement" | "city";
}

export interface TradeOffer {
  from: SeatId;
  give: Partial<Hand>;
  want: Partial<Hand>;
  /** Seats that have said yes. */
  accepted: SeatId[];
  declined: SeatId[];
}

export interface LandfallState extends BaseState {
  terrain: Terrain[];
  numbers: (number | null)[];
  ports: (PortKind | null)[];
  buildings: Record<number, Building>;
  roads: Record<number, SeatId>;
  hands: Record<SeatId, Hand>;
  devs: Record<SeatId, { card: DevCard; boughtOnTurn: number; played: boolean }[]>;
  devDeck: DevCard[];
  bank: Hand;
  robber: number;
  knights: Record<SeatId, number>;
  longestRoad: { seat: SeatId; length: number } | null;
  largestArmy: { seat: SeatId; count: number } | null;
  names: Record<SeatId, string>;
  turn: SeatId;
  turnNumber: number;
  phase: "setup" | "roll" | "main";
  /** Snake order for the opening placements. */
  setupQueue: SeatId[];
  setupStage: "settlement" | "road";
  lastSetupVertex: number | null;
  lastRoll: [number, number] | null;
  playedDevThisTurn: boolean;
  freeRoads: number;
  /** Offers made this turn — a table can haggle, but not forever. */
  offersThisTurn: number;
  offer: TradeOffer | null;
  tradingOn: boolean;
  target: number;
  winner: SeatId | null;
  finished: boolean;
}

const emptyHand = (): Hand => ({ wood: 0, grain: 0, wool: 0, brick: 0, ore: 0 });
export const handSize = (hand: Hand): number => RESOURCES.reduce((n, r) => n + hand[r], 0);

const canAfford = (hand: Hand, cost: Partial<Hand>): boolean =>
  RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));

const pay = (hand: Hand, bank: Hand, cost: Partial<Hand>): void => {
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    hand[r] -= n;
    bank[r] += n;
  }
};

export function createState(config: LandfallConfig, seats: Seat[], seed: string): LandfallState {
  const rng = new Rng(seed);

  let terrain: Terrain[];
  let numbers: (number | null)[];

  if (config.layout === "beginner") {
    terrain = [...TERRAIN_BAG];
    numbers = layNumbers(terrain, [...NUMBER_BAG]);
  } else {
    // Variable setup, reshuffled until no two red numbers touch.
    let attempt = 0;
    do {
      terrain = rng.shuffle(TERRAIN_BAG);
      numbers = layNumbers(terrain, rng.shuffle(NUMBER_BAG));
      attempt++;
    } while (attempt < 200 && hotNeighbours(numbers));
  }

  const hands: Record<SeatId, Hand> = {};
  const devs: LandfallState["devs"] = {};
  const knights: Record<SeatId, number> = {};
  const names: Record<SeatId, string> = {};
  for (const seat of seats) {
    hands[seat.id] = emptyHand();
    devs[seat.id] = [];
    knights[seat.id] = 0;
    names[seat.id] = seat.name;
  }

  // Snake: round the table, then back again.
  const order = seats.map((s) => s.id);
  const setupQueue = [...order, ...[...order].reverse()];

  return {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    terrain,
    numbers,
    ports: VERTICES.map((v) => v.port),
    buildings: {},
    roads: {},
    hands,
    devs,
    devDeck: rng.shuffle(DEV_BAG),
    bank: { wood: 19, grain: 19, wool: 19, brick: 19, ore: 19 },
    robber: terrain.findIndex((t) => t === "desert"),
    knights,
    longestRoad: null,
    largestArmy: null,
    names,
    turn: setupQueue[0]!,
    turnNumber: 0,
    phase: "setup",
    setupQueue,
    setupStage: "settlement",
    lastSetupVertex: null,
    lastRoll: null,
    playedDevThisTurn: false,
    freeRoads: 0,
    offersThisTurn: 0,
    offer: null,
    tradingOn: config.trading,
    target: Number(config.target),
    winner: null,
    finished: false
  };
}

function layNumbers(terrain: Terrain[], bag: number[]): (number | null)[] {
  const numbers: (number | null)[] = Array(HEXES.length).fill(null);
  let i = 0;
  for (const hex of NUMBER_SPIRAL) {
    if (terrain[hex] === "desert") continue;
    numbers[hex] = bag[i++] ?? null;
  }
  return numbers;
}

/** True if two of the hottest numbers sit next to each other. */
function hotNeighbours(numbers: (number | null)[]): boolean {
  for (const hex of HEXES) {
    if (numbers[hex.id] !== 6 && numbers[hex.id] !== 8) continue;
    for (const other of HEXES) {
      if (other.id === hex.id) continue;
      if (numbers[other.id] !== 6 && numbers[other.id] !== 8) continue;
      const shared = hex.corners.filter((c) => other.corners.includes(c)).length;
      if (shared >= 2) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------- geometry */

export const buildingsOf = (state: LandfallState, seat: SeatId): number[] =>
  Object.keys(state.buildings)
    .map(Number)
    .filter((v) => state.buildings[v]!.seat === seat);

export function canSettle(state: LandfallState, vertex: number, seat: SeatId, setup: boolean): string | null {
  if (state.buildings[vertex]) return "Somebody is already there.";
  const v = VERTICES[vertex];
  if (!v) return "That isn't a corner of the island.";
  // The distance rule: never next door to another settlement.
  for (const n of v.neighbours) if (state.buildings[n]) return "Too close to another settlement.";
  if (setup) return null;
  const connected = edgesAt(vertex).some((e) => state.roads[e.id] === seat);
  return connected ? null : "You need a road of your own running to it.";
}

export function canRoad(state: LandfallState, edgeId: number, seat: SeatId): string | null {
  const edge = EDGES[edgeId];
  if (!edge) return "That isn't a stretch of the island.";
  if (state.roads[edgeId] !== undefined) return "There's already a road there.";
  const touchesOwn = [edge.a, edge.b].some((v) => {
    const building = state.buildings[v];
    if (building?.seat === seat) return true;
    // A road may also continue from another of your roads, unless a rival
    // settlement stands in the way.
    if (building && building.seat !== seat) return false;
    return edgesAt(v).some((e) => e.id !== edgeId && state.roads[e.id] === seat);
  });
  return touchesOwn ? null : "Roads have to join your own network.";
}

/** The longest unbroken run of one player's roads. */
export function longestRoadFor(state: LandfallState, seat: SeatId): number {
  const own = Object.keys(state.roads)
    .map(Number)
    .filter((id) => state.roads[id] === seat);
  if (own.length === 0) return 0;

  const byVertex = new Map<number, number[]>();
  for (const id of own) {
    const edge = EDGES[id]!;
    byVertex.set(edge.a, [...(byVertex.get(edge.a) ?? []), id]);
    byVertex.set(edge.b, [...(byVertex.get(edge.b) ?? []), id]);
  }

  let best = 0;
  const used = new Set<number>();
  const walk = (vertex: number, length: number): void => {
    if (length > best) best = length;
    // A rival settlement cuts the road here.
    const building = state.buildings[vertex];
    if (building && building.seat !== seat) return;
    for (const id of byVertex.get(vertex) ?? []) {
      if (used.has(id)) continue;
      const edge = EDGES[id]!;
      used.add(id);
      walk(edge.a === vertex ? edge.b : edge.a, length + 1);
      used.delete(id);
    }
  };
  for (const vertex of byVertex.keys()) walk(vertex, 0);
  return best;
}

export function victoryPoints(state: LandfallState, seat: SeatId, includeHidden: boolean): number {
  let points = 0;
  for (const vertex of buildingsOf(state, seat)) {
    points += state.buildings[vertex]!.type === "city" ? 2 : 1;
  }
  if (state.longestRoad?.seat === seat) points += 2;
  if (state.largestArmy?.seat === seat) points += 2;
  if (includeHidden) points += (state.devs[seat] ?? []).filter((d) => d.card === "victory").length;
  return points;
}

/* ------------------------------------------------------------ production */

export function portRates(state: LandfallState, seat: SeatId): Record<Resource, number> {
  const rates: Record<Resource, number> = { wood: 4, grain: 4, wool: 4, brick: 4, ore: 4 };
  for (const vertex of buildingsOf(state, seat)) {
    const port = state.ports[vertex];
    if (!port) continue;
    if (port === "any") {
      for (const r of RESOURCES) rates[r] = Math.min(rates[r], 3);
    } else {
      rates[port] = Math.min(rates[port], 2);
    }
  }
  return rates;
}

function produce(state: LandfallState, roll: number, events: GameEvent[]): void {
  const gains: Record<SeatId, Partial<Hand>> = {};
  for (const hex of HEXES) {
    if (state.numbers[hex.id] !== roll) continue;
    if (state.robber === hex.id) continue;
    const terrain = state.terrain[hex.id]!;
    if (terrain === "desert") continue;
    for (const vertex of hex.corners) {
      const building = state.buildings[vertex];
      if (!building) continue;
      const amount = building.type === "city" ? 2 : 1;
      const bucket = (gains[building.seat] ??= {});
      bucket[terrain] = (bucket[terrain] ?? 0) + amount;
    }
  }

  for (const [seatKey, bucket] of Object.entries(gains)) {
    const seat = Number(seatKey);
    for (const r of RESOURCES) {
      const want = bucket[r] ?? 0;
      // The bank can run dry, and when it does nobody gets that resource.
      const given = Math.min(want, state.bank[r]);
      state.hands[seat]![r] += given;
      state.bank[r] -= given;
    }
    const total = RESOURCES.reduce((n, r) => n + (bucket[r] ?? 0), 0);
    if (total > 0) {
      events.push({
        type: "produce",
        seat,
        text: `${state.names[seat]} collects ${total}.`,
        data: { bucket },
        sfx: "cubePlace"
      });
    }
  }
}

/* ------------------------------------------------------------ legal moves */

export function currentSeats(state: LandfallState): SeatId[] {
  if (state.finished) return [];
  // Two things ask several seats at once: a seven, where everyone over the hand
  // limit discards, and an offer, where everyone gets to say yes or no. Both
  // are answered simultaneously rather than in turn order.
  const discards = state.pending.filter((p) => p.kind === "discard");
  if (discards.length) return discards.map((p) => p.seat);
  const offers = state.pending.filter((p) => p.kind === "offer");
  if (offers.length) return offers.map((p) => p.seat);
  if (state.pending.length) return [state.pending.at(-1)!.seat];
  // Everyone has answered: the offer is back with whoever made it.
  if (state.offer) return [state.offer.from];
  return [state.turn];
}

export function legalMoves(state: LandfallState, seat: SeatId): LandfallMove[] {
  if (state.finished) return [];
  const mine = state.pending.filter((p) => p.seat === seat);
  const open = mine.at(-1);

  if (open?.kind === "discard") {
    const hand = state.hands[seat]!;
    const half = Math.floor(handSize(hand) / 2);
    // Offer a spread of ways to pay rather than every combination.
    return discardOptions(hand, half).map((give) => ({ kind: "discard" as const, give }));
  }
  if (open?.kind === "offer") {
    // You can only say yes to something you can actually pay for. Checking it
    // here rather than at the close keeps the offerer from learning anything
    // about your hand from what you were allowed to answer.
    const canCover = state.offer
      ? RESOURCES.every((r) => state.hands[seat]![r] >= (state.offer!.want[r] ?? 0))
      : false;
    return canCover
      ? [
          { kind: "respond", accept: true },
          { kind: "respond", accept: false }
        ]
      : [{ kind: "respond", accept: false }];
  }
  if (open?.kind === "robber") {
    // Nothing else happens until the robber has been placed — not building,
    // not trading, and certainly not passing the dice on.
    const moves: LandfallMove[] = [];
    for (const hex of HEXES) {
      if (hex.id === state.robber) continue;
      for (const target of stealTargets(state, hex.id, seat)) {
        moves.push({ kind: "move-robber", hex: hex.id, steal: target });
      }
    }
    return moves;
  }
  if (state.pending.length && !mine.length) return [];

  if (state.offer && state.offer.from === seat && state.pending.every((p) => p.kind !== "offer")) {
    const moves: LandfallMove[] = [{ kind: "close-offer", with: null }];
    for (const other of state.offer.accepted) moves.push({ kind: "close-offer", with: other });
    return moves;
  }

  if (state.turn !== seat) return [];
  const hand = state.hands[seat]!;
  const moves: LandfallMove[] = [];

  if (state.phase === "setup") {
    if (state.setupStage === "settlement") {
      for (const v of VERTICES) {
        if (!canSettle(state, v.id, seat, true)) moves.push({ kind: "place-settlement", vertex: v.id });
      }
    } else {
      const from = state.lastSetupVertex;
      for (const edge of from === null ? [] : edgesAt(from)) {
        if (state.roads[edge.id] === undefined) moves.push({ kind: "place-road", edge: edge.id });
      }
    }
    return moves;
  }

  if (state.phase === "roll") {
    moves.push({ kind: "roll" });
    // A soldier may be played before the roll — the classic opening trick.
    if (playableDev(state, seat, "soldier")) {
      for (const hex of HEXES) {
        if (hex.id === state.robber) continue;
        for (const target of stealTargets(state, hex.id, seat)) {
          moves.push({ kind: "play-soldier", hex: hex.id, steal: target });
        }
      }
    }
    return moves;
  }

  // phase "main"
  if (canAfford(hand, COSTS.road) || state.freeRoads > 0) {
    for (const edge of EDGES) {
      if (!canRoad(state, edge.id, seat)) moves.push({ kind: "build-road", edge: edge.id });
    }
  }
  if (canAfford(hand, COSTS.settlement)) {
    for (const v of VERTICES) {
      if (!canSettle(state, v.id, seat, false)) moves.push({ kind: "build-settlement", vertex: v.id });
    }
  }
  if (canAfford(hand, COSTS.city)) {
    for (const vertex of buildingsOf(state, seat)) {
      if (state.buildings[vertex]!.type === "settlement") moves.push({ kind: "build-city", vertex });
    }
  }
  if (canAfford(hand, COSTS.development) && state.devDeck.length > 0) moves.push({ kind: "buy-dev" });

  if (playableDev(state, seat, "soldier")) {
    for (const hex of HEXES) {
      if (hex.id === state.robber) continue;
      for (const target of stealTargets(state, hex.id, seat)) {
        moves.push({ kind: "play-soldier", hex: hex.id, steal: target });
      }
    }
  }
  if (playableDev(state, seat, "monopoly")) {
    for (const r of RESOURCES) moves.push({ kind: "play-monopoly", resource: r });
  }
  if (playableDev(state, seat, "plenty")) {
    for (const a of RESOURCES) for (const b of RESOURCES) moves.push({ kind: "play-plenty", resources: [a, b] });
  }
  if (playableDev(state, seat, "roads")) {
    moves.push({ kind: "play-roads", edges: [] });
  }

  const rates = portRates(state, seat);
  for (const give of RESOURCES) {
    if (hand[give] < rates[give]) continue;
    for (const get of RESOURCES) {
      if (give === get) continue;
      if (state.bank[get] <= 0) continue;
      moves.push({ kind: "bank-trade", give, get });
    }
  }

  if (state.tradingOn && !state.offer && state.seatCount > 1 && state.offersThisTurn < 2) {
    // A small, sensible set of offers rather than the whole combinatorial mess:
    // one of anything you hold, for one of anything you don't.
    for (const give of RESOURCES) {
      if (hand[give] < 1) continue;
      for (const want of RESOURCES) {
        if (give === want) continue;
        moves.push({ kind: "offer", give: { [give]: 1 }, want: { [want]: 1 } });
      }
    }
  }

  moves.push({ kind: "end-turn" });
  return moves;
}

function discardOptions(hand: Hand, count: number): Partial<Hand>[] {
  if (count <= 0) return [{}];
  // Take from the deepest pile first; also offer an even spread.
  const greedy: Partial<Hand> = {};
  const working = { ...hand };
  for (let i = 0; i < count; i++) {
    const pick = RESOURCES.slice().sort((a, b) => working[b] - working[a])[0]!;
    if (working[pick] <= 0) break;
    working[pick]--;
    greedy[pick] = (greedy[pick] ?? 0) + 1;
  }
  const spread: Partial<Hand> = {};
  const working2 = { ...hand };
  let left = count;
  while (left > 0) {
    let moved = false;
    for (const r of RESOURCES) {
      if (left <= 0) break;
      if (working2[r] <= 0) continue;
      working2[r]--;
      spread[r] = (spread[r] ?? 0) + 1;
      left--;
      moved = true;
    }
    if (!moved) break;
  }
  const options = [greedy, spread];
  return options.filter((o, i) => options.findIndex((x) => JSON.stringify(x) === JSON.stringify(o)) === i);
}

function playableDev(state: LandfallState, seat: SeatId, card: DevCard): boolean {
  if (state.playedDevThisTurn) return false;
  return (state.devs[seat] ?? []).some(
    (d) => d.card === card && !d.played && d.boughtOnTurn < state.turnNumber
  );
}

export function stealTargets(state: LandfallState, hex: number, seat: SeatId): (SeatId | null)[] {
  const targets = new Set<SeatId>();
  for (const vertex of HEXES[hex]!.corners) {
    const building = state.buildings[vertex];
    if (!building || building.seat === seat) continue;
    if (handSize(state.hands[building.seat]!) > 0) targets.add(building.seat);
  }
  return targets.size ? [...targets] : [null];
}

/* --------------------------------------------------------------- applying */

export function applyMove(
  state: LandfallState,
  seat: SeatId,
  move: LandfallMove
): Result<{ state: LandfallState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  const kind = (move as { kind?: string })?.kind;
  const mine = state.pending.filter((p) => p.seat === seat);
  const open = mine.at(-1);

  if (open?.kind === "discard" && kind !== "discard") {
    return err("must-discard", "Discard down to half your hand first.");
  }
  if (open?.kind === "offer" && kind !== "respond") {
    return err("must-answer", "Answer the offer on the table first.");
  }
  if (open?.kind === "robber" && kind !== "move-robber") {
    return err("must-move-robber", "Place the robber first.");
  }
  if (!open && state.pending.length) return err("waiting", "The table is waiting on somebody else.");
  if (!open && state.offer && state.offer.from !== seat) {
    return err("offer-open", "There's an offer on the table.");
  }
  if (!open && !state.offer && state.turn !== seat) return err("not-your-turn", "Wait for your turn.");

  const next = clone(state);
  const hand = next.hands[seat]!;
  const events: GameEvent[] = [];

  switch (kind) {
    /* ------------------------------------------------------------ setup */
    case "place-settlement": {
      if (next.phase !== "setup") return err("wrong-phase", "That's for the opening placements.");
      const { vertex } = move as { vertex: number };
      const problem = canSettle(next, vertex, seat, true);
      if (problem) return err("cannot-settle", problem);
      next.buildings[vertex] = { seat, type: "settlement" };
      next.setupStage = "road";
      next.lastSetupVertex = vertex;
      next.ply++;
      events.push({
        type: "settle",
        seat,
        text: `${next.names[seat]} settles.`,
        data: { vertex },
        sfx: "pieceSet"
      });

      // The second settlement pays out at once.
      const second = next.setupQueue.length <= next.seatCount;
      if (second) {
        for (const hexId of VERTICES[vertex]!.hexes) {
          const terrain = next.terrain[hexId]!;
          if (terrain === "desert") continue;
          hand[terrain]++;
          next.bank[terrain]--;
        }
        events.push({
          type: "produce",
          seat,
          text: `${next.names[seat]} takes the first harvest.`,
          sfx: "cubePlace"
        });
      }
      return ok({ state: next, events });
    }

    case "place-road": {
      if (next.phase !== "setup") return err("wrong-phase", "That's for the opening placements.");
      const { edge } = move as { edge: number };
      const from = next.lastSetupVertex;
      if (from === null) return err("settle-first", "Place your settlement first.");
      if (!edgesAt(from).some((e) => e.id === edge)) {
        return err("not-adjacent", "The road has to leave the settlement you just placed.");
      }
      if (next.roads[edge] !== undefined) return err("occupied", "There's already a road there.");
      next.roads[edge] = seat;
      next.lastSetupVertex = null;
      next.setupStage = "settlement";
      next.setupQueue.shift();
      next.ply++;
      events.push({ type: "road", seat, text: `${next.names[seat]} lays a road.`, data: { edge }, sfx: "pieceSet" });

      if (next.setupQueue.length === 0) {
        next.phase = "roll";
        next.turn = 0;
        next.turnNumber = 1;
        events.push({ type: "start", text: "The island is settled. Roll to begin.", sfx: "start" });
      } else {
        next.turn = next.setupQueue[0]!;
      }
      updateLongestRoad(next, events);
      return ok({ state: next, events });
    }

    /* ------------------------------------------------------------- roll */
    case "roll": {
      if (next.phase !== "roll") return err("wrong-phase", "You've already rolled.");
      const rng = Rng.from(next.rng);
      const dice: [number, number] = [rng.die(), rng.die()];
      next.rng = rng.serialize();
      next.lastRoll = dice;
      const total = dice[0] + dice[1];
      next.phase = "main";
      next.ply++;
      events.push({
        type: "roll",
        seat,
        text: `${next.names[seat]} rolls ${total}.`,
        data: { dice, total },
        sfx: "diceTumble"
      });

      if (total === 7) {
        // Everyone over the limit discards, all at once.
        let asked = 0;
        for (const other of Object.keys(next.hands).map(Number)) {
          if (handSize(next.hands[other]!) > 7) {
            next.pending.push({
              id: pendingId(next, "discard", other),
              seat: other,
              kind: "discard",
              prompt: `You're holding ${handSize(next.hands[other]!)}. Discard half.`
            });
            asked++;
          }
        }
        next.pending.push({
          id: pendingId(next, "robber", seat),
          seat,
          kind: "robber",
          prompt: "Move the robber."
        });
        events.push({
          type: "seven",
          text: asked ? `A seven — ${asked} player${asked === 1 ? "" : "s"} must discard.` : "A seven.",
          sfx: "error"
        });
        return ok({ state: next, events });
      }

      produce(next, total, events);
      return ok({ state: next, events });
    }

    case "discard": {
      if (open?.kind !== "discard") return err("nothing-to-discard", "Nobody asked you to discard.");
      const { give } = move as { give: Partial<Hand> };
      const total = RESOURCES.reduce((n, r) => n + (give[r] ?? 0), 0);
      const half = Math.floor(handSize(hand) / 2);
      if (total !== half) return err("wrong-count", `Discard exactly ${half}.`);
      if (!canAfford(hand, give)) return err("short", "You don't hold those.");
      pay(hand, next.bank, give);
      next.pending = next.pending.filter((p) => p.id !== open.id);
      next.ply++;
      events.push({
        type: "discard",
        seat,
        text: `${next.names[seat]} discards ${total}.`,
        sfx: "cardSlip"
      });
      return ok({ state: next, events });
    }

    case "move-robber":
    case "play-soldier": {
      const isSoldier = kind === "play-soldier";
      if (!isSoldier && open?.kind !== "robber") {
        return err("no-robber", "The robber isn't waiting on you.");
      }
      if (isSoldier && !playableDev(next, seat, "soldier")) {
        return err("no-soldier", "You have no soldier you can play this turn.");
      }
      const { hex, steal } = move as { hex: number; steal: SeatId | null };
      if (!HEXES[hex]) return err("no-hex", "There's no such hex.");
      if (hex === next.robber) return err("same-hex", "The robber has to move somewhere new.");

      next.robber = hex;
      if (isSoldier) {
        const card = (next.devs[seat] ?? []).find(
          (d) => d.card === "soldier" && !d.played && d.boughtOnTurn < next.turnNumber
        )!;
        card.played = true;
        next.playedDevThisTurn = true;
        next.knights[seat] = (next.knights[seat] ?? 0) + 1;
        events.push({
          type: "soldier",
          seat,
          text: `${next.names[seat]} plays a soldier.`,
          sfx: "capture"
        });
        updateLargestArmy(next, events);
      } else {
        next.pending = next.pending.filter((p) => p.id !== open!.id);
      }

      events.push({
        type: "robber",
        seat,
        text: `${next.names[seat]} moves the robber.`,
        data: { hex },
        sfx: "swoosh"
      });

      if (steal !== null && steal !== undefined) {
        const victimHand = next.hands[steal];
        const onHex = HEXES[hex]!.corners.some((v) => next.buildings[v]?.seat === steal);
        if (!victimHand || !onHex) return err("no-victim", "You can't steal from them.");
        const pool: Resource[] = [];
        for (const r of RESOURCES) for (let i = 0; i < victimHand[r]; i++) pool.push(r);
        if (pool.length) {
          const rng = Rng.from(next.rng);
          const taken = rng.pick(pool);
          next.rng = rng.serialize();
          victimHand[taken]--;
          hand[taken]++;
          events.push({
            type: "steal",
            seat,
            text: `${next.names[seat]} takes a card from ${next.names[steal]}.`,
            sfx: "cardSlip"
          });
          events.push({
            type: "steal-private",
            seat,
            text: `You took ${taken}.`,
            data: { resource: taken },
            visibleTo: [seat, steal]
          });
        }
      }
      next.ply++;
      checkVictory(next, seat, events);
      return ok({ state: next, events });
    }

    /* ---------------------------------------------------------- building */
    case "build-road": {
      if (next.phase !== "main") return err("wrong-phase", "Roll first.");
      const { edge } = move as { edge: number };
      const problem = canRoad(next, edge, seat);
      if (problem) return err("cannot-build", problem);
      if (next.freeRoads > 0) next.freeRoads--;
      else {
        if (!canAfford(hand, COSTS.road)) return err("short", "A road costs wood and brick.");
        pay(hand, next.bank, COSTS.road);
      }
      next.roads[edge] = seat;
      next.ply++;
      events.push({ type: "road", seat, text: `${next.names[seat]} builds a road.`, data: { edge }, sfx: "pieceSet" });
      updateLongestRoad(next, events);
      checkVictory(next, seat, events);
      return ok({ state: next, events });
    }

    case "build-settlement": {
      if (next.phase !== "main") return err("wrong-phase", "Roll first.");
      const { vertex } = move as { vertex: number };
      const problem = canSettle(next, vertex, seat, false);
      if (problem) return err("cannot-build", problem);
      if (!canAfford(hand, COSTS.settlement)) return err("short", "You can't cover a settlement.");
      pay(hand, next.bank, COSTS.settlement);
      next.buildings[vertex] = { seat, type: "settlement" };
      next.ply++;
      events.push({
        type: "settle",
        seat,
        text: `${next.names[seat]} founds a settlement.`,
        data: { vertex },
        sfx: "claim"
      });
      // A new settlement can cut somebody's road in half.
      updateLongestRoad(next, events);
      checkVictory(next, seat, events);
      return ok({ state: next, events });
    }

    case "build-city": {
      if (next.phase !== "main") return err("wrong-phase", "Roll first.");
      const { vertex } = move as { vertex: number };
      const building = next.buildings[vertex];
      if (!building || building.seat !== seat) return err("not-yours", "That isn't your settlement.");
      if (building.type === "city") return err("already-city", "That's already a city.");
      if (!canAfford(hand, COSTS.city)) return err("short", "A city costs three ore and two grain.");
      pay(hand, next.bank, COSTS.city);
      building.type = "city";
      next.ply++;
      events.push({
        type: "city",
        seat,
        text: `${next.names[seat]} raises a city.`,
        data: { vertex },
        sfx: "claim"
      });
      checkVictory(next, seat, events);
      return ok({ state: next, events });
    }

    case "buy-dev": {
      if (next.phase !== "main") return err("wrong-phase", "Roll first.");
      if (!canAfford(hand, COSTS.development)) return err("short", "That costs ore, wool and grain.");
      if (next.devDeck.length === 0) return err("empty", "The development deck is empty.");
      pay(hand, next.bank, COSTS.development);
      const card = next.devDeck.shift()!;
      next.devs[seat] = [...(next.devs[seat] ?? []), { card, boughtOnTurn: next.turnNumber, played: false }];
      next.ply++;
      events.push({
        type: "dev",
        seat,
        text: `${next.names[seat]} buys a development card.`,
        sfx: "cardSlip"
      });
      events.push({
        type: "dev-private",
        seat,
        text: `You drew ${card}.`,
        data: { card },
        visibleTo: [seat]
      });
      checkVictory(next, seat, events);
      return ok({ state: next, events });
    }

    case "play-monopoly": {
      if (!playableDev(next, seat, "monopoly")) return err("no-card", "You can't play that this turn.");
      const { resource } = move as { resource: Resource };
      markPlayed(next, seat, "monopoly");
      let taken = 0;
      for (const other of Object.keys(next.hands).map(Number)) {
        if (other === seat) continue;
        taken += next.hands[other]![resource];
        hand[resource] += next.hands[other]![resource];
        next.hands[other]![resource] = 0;
      }
      next.ply++;
      events.push({
        type: "monopoly",
        seat,
        text: `${next.names[seat]} corners the ${resource} market and takes ${taken}.`,
        sfx: "claim"
      });
      return ok({ state: next, events });
    }

    case "play-plenty": {
      if (!playableDev(next, seat, "plenty")) return err("no-card", "You can't play that this turn.");
      const { resources } = move as { resources: Resource[] };
      if (!Array.isArray(resources) || resources.length !== 2) return err("bad-choice", "Name two resources.");
      markPlayed(next, seat, "plenty");
      for (const r of resources) {
        if (next.bank[r] <= 0) continue;
        next.bank[r]--;
        hand[r]++;
      }
      next.ply++;
      events.push({
        type: "plenty",
        seat,
        text: `${next.names[seat]} takes two from the bank.`,
        sfx: "cardSlip"
      });
      return ok({ state: next, events });
    }

    case "play-roads": {
      if (!playableDev(next, seat, "roads")) return err("no-card", "You can't play that this turn.");
      markPlayed(next, seat, "roads");
      next.freeRoads = 2;
      next.ply++;
      events.push({
        type: "roads",
        seat,
        text: `${next.names[seat]} lays two roads for nothing.`,
        sfx: "pieceSet"
      });
      return ok({ state: next, events });
    }

    /* ----------------------------------------------------------- trading */
    case "bank-trade": {
      if (next.phase !== "main") return err("wrong-phase", "Roll first.");
      const { give, get } = move as { give: Resource; get: Resource };
      const rate = portRates(next, seat)[give];
      if (hand[give] < rate) return err("short", `That trade costs ${rate} ${give}.`);
      if (next.bank[get] <= 0) return err("bank-empty", `The bank is out of ${get}.`);
      hand[give] -= rate;
      next.bank[give] += rate;
      hand[get]++;
      next.bank[get]--;
      next.ply++;
      events.push({
        type: "bank-trade",
        seat,
        text: `${next.names[seat]} trades ${rate} ${give} for a ${get}.`,
        sfx: "gemClink"
      });
      return ok({ state: next, events });
    }

    case "offer": {
      if (!next.tradingOn) return err("no-trading", "Trading is off at this table.");
      if (next.phase !== "main") return err("wrong-phase", "Roll first.");
      if (next.offer) return err("offer-open", "There's already an offer on the table.");
      const { give, want } = move as { give: Partial<Hand>; want: Partial<Hand> };
      if (!canAfford(hand, give)) return err("short", "You don't hold what you're offering.");
      if (RESOURCES.reduce((n, r) => n + (give[r] ?? 0) + (want[r] ?? 0), 0) === 0) {
        return err("empty-offer", "An offer has to be for something.");
      }
      next.offer = { from: seat, give, want, accepted: [], declined: [] };
      next.offersThisTurn++;
      for (const other of Object.keys(next.hands).map(Number)) {
        if (other === seat) continue;
        next.pending.push({
          id: pendingId(next, "offer", other),
          seat: other,
          kind: "offer",
          prompt: "There's a trade on the table."
        });
      }
      next.ply++;
      events.push({
        type: "offer",
        seat,
        text: `${next.names[seat]} offers a trade.`,
        data: { give, want },
        sfx: "nudge"
      });
      return ok({ state: next, events });
    }

    case "respond": {
      if (open?.kind !== "offer" || !next.offer) return err("no-offer", "There's nothing to answer.");
      const { accept } = move as { accept: boolean };
      if (accept) next.offer.accepted.push(seat);
      else next.offer.declined.push(seat);
      next.pending = next.pending.filter((p) => p.id !== open.id);
      next.ply++;
      events.push({
        type: "respond",
        seat,
        text: `${next.names[seat]} ${accept ? "would take that" : "passes"}.`
      });
      return ok({ state: next, events });
    }

    case "close-offer": {
      const offer = next.offer;
      if (!offer || offer.from !== seat) return err("no-offer", "You have no offer open.");
      const { with: partner } = move as { with: SeatId | null };
      next.pending = next.pending.filter((p) => p.kind !== "offer");

      if (partner === null) {
        next.offer = null;
        next.ply++;
        events.push({ type: "offer-closed", seat, text: `${next.names[seat]} withdraws the offer.` });
        return ok({ state: next, events });
      }
      if (!offer.accepted.includes(partner)) return err("not-accepted", "They didn't accept.");
      const theirs = next.hands[partner]!;
      if (!canAfford(hand, offer.give)) return err("short", "You no longer hold what you offered.");
      if (!canAfford(theirs, offer.want)) return err("their-short", "They can't cover it any more.");

      for (const r of RESOURCES) {
        const out = offer.give[r] ?? 0;
        const back = offer.want[r] ?? 0;
        hand[r] -= out;
        theirs[r] += out;
        theirs[r] -= back;
        hand[r] += back;
      }
      next.offer = null;
      next.ply++;
      events.push({
        type: "trade",
        seat,
        text: `${next.names[seat]} and ${next.names[partner]} shake on it.`,
        sfx: "gemClink"
      });
      return ok({ state: next, events });
    }

    case "end-turn": {
      if (next.phase === "setup") return err("wrong-phase", "Finish placing first.");
      if (next.phase === "roll") return err("roll-first", "Roll the dice before you pass them on.");
      if (next.offer) return err("offer-open", "Close the offer on the table first.");
      next.phase = "roll";
      next.playedDevThisTurn = false;
      next.freeRoads = 0;
      next.offersThisTurn = 0;
      next.turn = (seat + 1) % next.seatCount;
      next.turnNumber++;
      next.ply++;
      return ok({ state: next, events });
    }

    default:
      return err("unknown-move", "That isn't a move this game understands.");
  }
}

function markPlayed(state: LandfallState, seat: SeatId, card: DevCard): void {
  const held = (state.devs[seat] ?? []).find(
    (d) => d.card === card && !d.played && d.boughtOnTurn < state.turnNumber
  );
  if (held) held.played = true;
  state.playedDevThisTurn = true;
}

function updateLongestRoad(state: LandfallState, events: GameEvent[]): void {
  let best = state.longestRoad;
  for (const seat of Object.keys(state.hands).map(Number)) {
    const length = longestRoadFor(state, seat);
    if (length < 5) continue;
    if (!best || length > best.length) best = { seat, length };
    else if (best.seat === seat) best = { seat, length };
  }
  // A road that has been cut can lose the title outright.
  if (best && longestRoadFor(state, best.seat) < 5) best = null;
  if (best?.seat !== state.longestRoad?.seat) {
    state.longestRoad = best;
    if (best) {
      events.push({
        type: "longest-road",
        seat: best.seat,
        text: `${state.names[best.seat]} has the longest road at ${best.length}.`,
        sfx: "score"
      });
    }
  } else {
    state.longestRoad = best;
  }
}

function updateLargestArmy(state: LandfallState, events: GameEvent[]): void {
  let best = state.largestArmy;
  for (const seat of Object.keys(state.knights).map(Number)) {
    const count = state.knights[seat] ?? 0;
    if (count < 3) continue;
    if (!best || count > best.count) best = { seat, count };
    else if (best.seat === seat) best = { seat, count };
  }
  if (best && best.seat !== state.largestArmy?.seat) {
    events.push({
      type: "largest-army",
      seat: best.seat,
      text: `${state.names[best.seat]} commands the largest army.`,
      sfx: "score"
    });
  }
  state.largestArmy = best;
}

function checkVictory(state: LandfallState, seat: SeatId, events: GameEvent[]): void {
  if (victoryPoints(state, seat, true) >= state.target) {
    state.finished = true;
    state.winner = seat;
    events.push({
      type: "victory",
      seat,
      text: `${state.names[seat]} reaches ${state.target} points.`,
      sfx: "win"
    });
  }
}

export function isTerminal(state: LandfallState): boolean {
  return state.finished;
}

export function score(state: LandfallState): FinalScore[] {
  const entries = Object.keys(state.hands)
    .map(Number)
    .map((seat) => {
      const settlements = buildingsOf(state, seat).filter((v) => state.buildings[v]!.type === "settlement").length;
      const cities = buildingsOf(state, seat).filter((v) => state.buildings[v]!.type === "city").length;
      const hidden = (state.devs[seat] ?? []).filter((d) => d.card === "victory").length;
      return {
        seat,
        total: victoryPoints(state, seat, true),
        lines: [
          { label: "Settlements", value: settlements },
          { label: "Cities", value: cities * 2 },
          { label: "Longest road", value: state.longestRoad?.seat === seat ? 2 : 0 },
          { label: "Largest army", value: state.largestArmy?.seat === seat ? 2 : 0 },
          { label: "Charters", value: hidden }
        ]
      };
    });
  const ranked = rankScores(entries);
  if (state.winner !== null) for (const r of ranked) r.won = r.seat === state.winner;
  return ranked;
}

/* -------------------------------------------------------------- redaction */

export interface LandfallView {
  terrain: Terrain[];
  numbers: (number | null)[];
  ports: (PortKind | null)[];
  buildings: Record<number, Building>;
  roads: Record<number, SeatId>;
  hand: Hand;
  handCounts: Record<SeatId, number>;
  /** Your own development cards; everyone else's is a count. */
  devs: { card: DevCard; played: boolean; playable: boolean }[];
  devCounts: Record<SeatId, number>;
  knights: Record<SeatId, number>;
  bank: Hand;
  devDeckCount: number;
  robber: number;
  longestRoad: { seat: SeatId; length: number } | null;
  largestArmy: { seat: SeatId; count: number } | null;
  /** Public points: buildings and awards, never the hidden charters. */
  points: Record<SeatId, number>;
  names: Record<SeatId, string>;
  turn: SeatId;
  phase: string;
  setupStage: string;
  lastRoll: [number, number] | null;
  rates: Record<Resource, number>;
  offer: TradeOffer | null;
  winner: SeatId | null;
  finished: boolean;
  seat: SeatId | "spectator";
  pending: { kind: string; prompt?: string } | null;
}

export function redactStateFor(state: LandfallState, viewer: SeatId | "spectator"): LandfallView {
  const handCounts: Record<SeatId, number> = {};
  const devCounts: Record<SeatId, number> = {};
  const points: Record<SeatId, number> = {};
  for (const seat of Object.keys(state.hands).map(Number)) {
    handCounts[seat] = handSize(state.hands[seat]!);
    devCounts[seat] = (state.devs[seat] ?? []).filter((d) => !d.played).length;
    points[seat] = victoryPoints(state, seat, state.finished);
  }
  const open = viewer === "spectator" ? undefined : state.pending.filter((p) => p.seat === viewer).at(-1);

  return {
    terrain: state.terrain.slice(),
    numbers: state.numbers.slice(),
    ports: state.ports.slice(),
    buildings: clone(state.buildings),
    roads: { ...state.roads },
    hand: viewer === "spectator" ? emptyHand() : { ...state.hands[viewer]! },
    handCounts,
    devs:
      viewer === "spectator"
        ? []
        : (state.devs[viewer] ?? []).map((d) => ({
            card: d.card,
            played: d.played,
            playable: !d.played && d.boughtOnTurn < state.turnNumber && !state.playedDevThisTurn
          })),
    devCounts,
    knights: { ...state.knights },
    bank: { ...state.bank },
    devDeckCount: state.devDeck.length,
    robber: state.robber,
    longestRoad: state.longestRoad,
    largestArmy: state.largestArmy,
    points,
    names: { ...state.names },
    turn: state.turn,
    phase: state.phase,
    setupStage: state.setupStage,
    lastRoll: state.lastRoll,
    rates: viewer === "spectator" ? { wood: 4, grain: 4, wool: 4, brick: 4, ore: 4 } : portRates(state, viewer),
    offer: state.offer ? clone(state.offer) : null,
    winner: state.winner,
    finished: state.finished,
    seat: viewer,
    pending: open ? { kind: open.kind, prompt: open.prompt } : null
  };
}

export function describeMove(_state: LandfallState, _seat: SeatId, move: LandfallMove): string {
  return move.kind.replace("-", " ");
}

/** Ninety-five resource cards exist, and every one of them is somewhere. */
export function invariants(state: LandfallState): string | void {
  for (const r of RESOURCES) {
    let total = state.bank[r];
    for (const hand of Object.values(state.hands)) total += hand[r];
    if (total !== 19) return `${r} count is ${total}, should be 19`;
    if (state.bank[r] < 0) return `the bank owes ${r}`;
  }
  for (const hand of Object.values(state.hands)) {
    for (const r of RESOURCES) if (hand[r] < 0) return "a player has a negative resource";
  }
  const devs = Object.values(state.devs).flat().length + state.devDeck.length;
  if (devs !== DEV_BAG.length) return `development card count is ${devs}`;

  // The distance rule, always.
  for (const key of Object.keys(state.buildings).map(Number)) {
    for (const n of VERTICES[key]!.neighbours) {
      if (state.buildings[n]) return "two settlements are next door to each other";
    }
  }
  return undefined;
}
