/**
 * Boxcar — claim routes, connect the map.
 *
 * The fiddly parts, all of which are implemented here rather than waved at:
 * the face-up locomotive that costs both draws, tunnels that demand more after
 * you have committed, ferries that insist on locomotives, double tracks that
 * close at a small table, stations that borrow one neighbour's route at
 * scoring time, and the final lap once somebody is down to two cars.
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
  CARD_COLOURS,
  MAPS,
  citiesConnected,
  longestTrail,
  makeTrainDeck,
  routePoints,
  type BoxcarMap,
  type Card,
  type CardColour,
  type Ticket
} from "./maps";

export const configSchema = z.object({
  map: z.enum(["continental", "frontier", "subcontinent"]).default("continental"),
  /** Cars per player: fewer cars, shorter game. */
  cars: z.enum(["45", "30", "20"]).default("45"),
  /** Ten points for the most completed tickets. */
  globetrotter: z.boolean().default(true)
});

export type BoxcarConfig = z.infer<typeof configSchema>;

export type Hand = Record<Card, number>;

export type BoxcarMove =
  | { kind: "draw"; from: "deck" | number }
  | { kind: "claim"; route: number; colour: CardColour; locos: number }
  | { kind: "tickets" }
  | { kind: "keep"; ids: number[] }
  | { kind: "tunnel-pay"; locos: number }
  | { kind: "tunnel-withdraw" }
  | { kind: "station"; city: string; colour: CardColour; locos: number }
  | { kind: "pass" };

export interface BoxcarState extends BaseState {
  mapId: string;
  deck: Card[];
  discard: Card[];
  /** The five face-up cards. */
  market: (Card | null)[];
  ticketDeck: number[];
  longDeck: number[];
  hands: Record<SeatId, Hand>;
  /** Ticket ids held, by seat. */
  tickets: Record<SeatId, number[]>;
  /** Tickets offered and awaiting a keep decision, by seat. */
  offered: Record<SeatId, number[]>;
  claims: Record<number, SeatId>;
  cars: Record<SeatId, number>;
  stationsLeft: Record<SeatId, number>;
  stationCities: Record<SeatId, string[]>;
  routeScore: Record<SeatId, number>;
  names: Record<SeatId, string>;
  turn: SeatId;
  /** Draws remaining in the current turn; 2 at the start of a draw action. */
  drawsLeft: number;
  /** True while the initial ticket draft is being resolved simultaneously. */
  drafting: boolean;
  /** Set when a tunnel demands more; holds what was paid and what was revealed. */
  tunnel: {
    seat: SeatId;
    route: number;
    colour: CardColour;
    locos: number;
    /** Coloured cards laid out with the payment, held aside until it resolves. */
    coloured: number;
    revealed: Card[];
    extra: number;
  } | null;
  finalLap: boolean;
  /** Turns left once the final lap starts. */
  finalTurns: number;
  finished: boolean;
  globetrotter: boolean;
  carsPerPlayer: number;
}

const emptyHand = (): Hand => {
  const hand = {} as Hand;
  for (const c of CARD_COLOURS) hand[c] = 0;
  hand.loco = 0;
  return hand;
};

export const handSize = (hand: Hand): number => Object.values(hand).reduce((a, b) => a + b, 0);
export const mapOf = (state: BoxcarState): BoxcarMap => MAPS[state.mapId]!;

/* ------------------------------------------------------------------ setup */

/** Deal the market, redealing whenever three locomotives show at once. */
function refillMarket(state: BoxcarState): void {
  for (let guard = 0; guard < 20; guard++) {
    for (let i = 0; i < 5; i++) {
      if (state.market[i] === null || state.market[i] === undefined) {
        const card = drawCard(state);
        state.market[i] = card;
      }
    }
    const locos = state.market.filter((c) => c === "loco").length;
    const filled = state.market.filter((c) => c !== null).length;
    if (locos < 3 || filled < 5) return;
    // Three locomotives on the table is too rich: sweep the lot and redeal.
    for (let i = 0; i < 5; i++) {
      if (state.market[i]) state.discard.push(state.market[i]!);
      state.market[i] = null;
    }
  }
}

function drawCard(state: BoxcarState): Card | null {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null;
    const rng = Rng.from(state.rng);
    state.deck = rng.shuffle(state.discard);
    state.discard = [];
    state.rng = rng.serialize();
  }
  return state.deck.shift() ?? null;
}

export function createState(config: BoxcarConfig, seats: Seat[], seed: string): BoxcarState {
  const rng = new Rng(seed);
  const map = MAPS[config.map]!;
  const regular = map.tickets.filter((t) => !t.long).map((t) => t.id);
  const long = map.tickets.filter((t) => t.long).map((t) => t.id);

  const state: BoxcarState = {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    mapId: config.map,
    deck: rng.shuffle(makeTrainDeck()),
    discard: [],
    market: [null, null, null, null, null],
    ticketDeck: rng.shuffle(regular),
    longDeck: rng.shuffle(long),
    hands: {},
    tickets: {},
    offered: {},
    claims: {},
    cars: {},
    stationsLeft: {},
    stationCities: {},
    routeScore: {},
    names: {},
    turn: seats[0]!.id,
    drawsLeft: 0,
    drafting: true,
    tunnel: null,
    finalLap: false,
    finalTurns: 0,
    finished: false,
    globetrotter: config.globetrotter,
    carsPerPlayer: Number(config.cars)
  };
  state.rng = rng.serialize();

  for (const s of seats) {
    state.hands[s.id] = emptyHand();
    state.tickets[s.id] = [];
    state.cars[s.id] = state.carsPerPlayer;
    state.stationsLeft[s.id] = map.stations ? 3 : 0;
    state.stationCities[s.id] = [];
    state.routeScore[s.id] = 0;
    state.names[s.id] = s.name;
    // Four train cards each…
    for (let i = 0; i < 4; i++) {
      const card = drawCard(state);
      if (card) state.hands[s.id]![card]++;
    }
    // …and a draft of one long ticket plus three regular ones.
    const offer: number[] = [];
    if (state.longDeck.length) offer.push(state.longDeck.shift()!);
    for (let i = 0; i < 3 && state.ticketDeck.length; i++) offer.push(state.ticketDeck.shift()!);
    state.offered[s.id] = offer;
    state.pending.push({
      id: `draft:${s.id}`,
      seat: s.id,
      kind: "initial-tickets",
      prompt: "Keep at least two of these four."
    });
  }

  refillMarket(state);
  return state;
}

export function currentSeats(state: BoxcarState): SeatId[] {
  if (state.finished) return [];
  // The opening draft is simultaneous: everyone decides at once.
  if (state.drafting) return state.pending.map((p) => p.seat);
  if (state.pending.length) return [state.pending.at(-1)!.seat];
  return [state.turn];
}

/* ------------------------------------------------------------ legal moves */

const subsetsKeeping = (ids: number[], minimum: number): number[][] => {
  const out: number[][] = [];
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const picked = ids.filter((_, i) => mask & (1 << i));
    if (picked.length >= minimum) out.push(picked);
  }
  return out;
};

export function ticketOf(state: BoxcarState, id: number): Ticket {
  return mapOf(state).tickets[id]!;
}

/** Payments the hand can actually make for a route, cheapest in wilds first. */
export function paymentsFor(state: BoxcarState, seat: SeatId, routeId: number): { colour: CardColour; locos: number }[] {
  const route = mapOf(state).routes[routeId]!;
  const hand = state.hands[seat]!;
  const colours: CardColour[] = route.color === "gray" ? [...CARD_COLOURS] : [route.color];
  const out: { colour: CardColour; locos: number }[] = [];

  for (const colour of colours) {
    // Locomotives are wild but precious, so the offered payment always uses as
    // few as the route allows. A ferry's minimum is its own business.
    const minLocos = Math.max(route.ferry, route.len - hand[colour]!);
    const locos = Math.max(0, minLocos);
    if (locos > route.len) continue;
    if (hand.loco < locos) continue;
    if (hand[colour]! < route.len - locos) continue;
    out.push({ colour, locos });
  }
  return out;
}

export function canClaim(state: BoxcarState, seat: SeatId, routeId: number): string | null {
  const map = mapOf(state);
  const route = map.routes[routeId];
  if (!route) return "There's no route there.";
  if (state.claims[routeId] !== undefined) return "That route is already claimed.";
  if ((state.cars[seat] ?? 0) < route.len) return "You don't have enough cars left.";

  if (route.twin !== undefined) {
    const twinOwner = state.claims[route.twin];
    if (twinOwner === seat) return "You can't own both tracks of a double route.";
    if (twinOwner !== undefined && state.seatCount <= 3) {
      return "At this table size only one track of a double may be claimed.";
    }
  }
  return null;
}

export function legalMoves(state: BoxcarState, seat: SeatId): BoxcarMove[] {
  if (state.finished) return [];

  // Opening draft, or a keep/tunnel decision.
  const mine = state.pending.filter((p) => p.seat === seat);
  if (mine.length) {
    const open = mine.at(-1)!;
    if (open.kind === "initial-tickets") {
      return subsetsKeeping(state.offered[seat] ?? [], 2).map((ids) => ({ kind: "keep" as const, ids }));
    }
    if (open.kind === "keep-tickets") {
      return subsetsKeeping(state.offered[seat] ?? [], 1).map((ids) => ({ kind: "keep" as const, ids }));
    }
    if (open.kind === "tunnel") {
      const t = state.tunnel!;
      const hand = state.hands[seat]!;
      const moves: BoxcarMove[] = [{ kind: "tunnel-withdraw" }];
      // Pay the extra in as few locomotives as the hand allows.
      const minLocos = Math.max(0, t.extra - hand[t.colour]!);
      if (hand.loco >= minLocos && minLocos <= t.extra) {
        moves.push({ kind: "tunnel-pay", locos: minLocos });
      }
      return moves;
    }
    return [];
  }

  if (state.pending.length || state.drafting) return [];
  if (state.turn !== seat) return [];

  const moves: BoxcarMove[] = [];
  const hand = state.hands[seat]!;

  // 1 · draw train cards
  const deckHasCards = state.deck.length > 0 || state.discard.length > 0;
  if (deckHasCards) moves.push({ kind: "draw", from: "deck" });
  state.market.forEach((card, i) => {
    if (!card) return;
    // A face-up locomotive costs both draws, so it can only be a first pick.
    if (card === "loco" && state.drawsLeft === 1) return;
    moves.push({ kind: "draw", from: i });
  });

  // Mid-draw, drawing is the only thing you may do.
  if (state.drawsLeft === 1) {
    if (moves.length === 0) moves.push({ kind: "pass" });
    return moves;
  }

  // 2 · claim a route
  for (const route of mapOf(state).routes) {
    if (canClaim(state, seat, route.id)) continue;
    for (const pay of paymentsFor(state, seat, route.id)) {
      moves.push({ kind: "claim", route: route.id, colour: pay.colour, locos: pay.locos });
    }
  }

  // 3 · draw destination tickets
  if (state.ticketDeck.length > 0) moves.push({ kind: "tickets" });

  // 4 · build a station
  if ((state.stationsLeft[seat] ?? 0) > 0) {
    const built = 3 - state.stationsLeft[seat]!;
    const cost = built + 1;
    const taken = new Set(Object.values(state.stationCities).flat());
    for (const city of mapOf(state).cities) {
      if (taken.has(city.key)) continue;
      for (const colour of CARD_COLOURS) {
        const locos = Math.max(0, cost - hand[colour]!);
        if (hand.loco < locos) continue;
        if (hand[colour]! < cost - locos) continue;
        moves.push({ kind: "station", city: city.key, colour, locos });
      }
    }
  }

  if (moves.length === 0) moves.push({ kind: "pass" });
  return moves;
}

/* --------------------------------------------------------------- applying */

export function applyMove(
  state: BoxcarState,
  seat: SeatId,
  move: BoxcarMove
): Result<{ state: BoxcarState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  const kind = (move as { kind?: string })?.kind;
  const mine = state.pending.filter((p) => p.seat === seat);
  const open = mine.at(-1);

  if (open) {
    if (open.kind === "initial-tickets" || open.kind === "keep-tickets") {
      if (kind !== "keep") return err("must-keep", "Choose which tickets to keep first.");
    } else if (open.kind === "tunnel") {
      if (kind !== "tunnel-pay" && kind !== "tunnel-withdraw") {
        return err("tunnel-open", "The tunnel wants an answer first.");
      }
    }
  } else if (state.pending.length) {
    return err("not-your-turn", "Someone else is deciding right now.");
  } else if (state.turn !== seat) {
    return err("not-your-turn", "Wait for your turn.");
  }

  const next = clone(state);
  const hand = next.hands[seat]!;
  const events: GameEvent[] = [];

  switch (kind) {
    case "keep": {
      const { ids } = move as { ids: number[] };
      const offered = next.offered[seat] ?? [];
      const minimum = open!.kind === "initial-tickets" ? 2 : 1;
      if (!Array.isArray(ids) || ids.length < minimum) {
        return err("keep-more", `Keep at least ${minimum}.`);
      }
      if (ids.some((id) => !offered.includes(id))) return err("not-offered", "That ticket wasn't offered.");

      next.tickets[seat] = [...(next.tickets[seat] ?? []), ...ids];
      const rejected = offered.filter((id) => !ids.includes(id));
      for (const id of rejected) {
        const ticket = ticketOf(next, id);
        // A rejected long ticket leaves the game; a regular one goes to the bottom.
        if (!ticket.long) next.ticketDeck.push(id);
      }
      next.offered[seat] = [];
      next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.ply++;
      events.push({
        type: "tickets-kept",
        seat,
        text: `${next.names[seat]} keeps ${ids.length} ticket${ids.length === 1 ? "" : "s"}.`,
        data: { count: ids.length },
        // Which tickets, exactly, is nobody else's business.
        visibleTo: [seat],
        sfx: "cardSlip"
      });

      if (next.drafting && next.pending.length === 0) {
        next.drafting = false;
        events.push({ type: "start", text: "All aboard — the line is open.", sfx: "trainClack" });
      }
      if (!next.drafting && open!.kind === "keep-tickets") endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    case "draw": {
      const { from } = move as { from: "deck" | number };
      if (next.drawsLeft === 0) next.drawsLeft = 2;

      let card: Card | null = null;
      let wasMarketLoco = false;
      if (from === "deck") {
        card = drawCard(next);
        if (!card) return err("deck-empty", "There are no cards left to draw.");
      } else {
        const index = Number(from);
        card = next.market[index] ?? null;
        if (!card) return err("no-card", "There's no card in that slot.");
        if (card === "loco" && next.drawsLeft === 1) {
          return err("loco-first", "A face-up locomotive costs both draws — take it first.");
        }
        wasMarketLoco = card === "loco";
        next.market[index] = null;
        refillMarket(next);
      }

      hand[card]++;
      next.drawsLeft = wasMarketLoco ? 0 : next.drawsLeft - 1;
      next.ply++;
      events.push({
        type: "draw",
        seat,
        text: `${next.names[seat]} draws${from === "deck" ? " blind" : ` a ${card} card`}.`,
        data: { from, card: from === "deck" ? null : card },
        sfx: "cardDeal"
      });

      const nothingLeft = next.deck.length === 0 && next.discard.length === 0 &&
        next.market.every((c) => c === null);
      if (next.drawsLeft === 0 || nothingLeft) {
        next.drawsLeft = 0;
        endTurn(next, seat, events);
      }
      return ok({ state: next, events });
    }

    case "claim": {
      const { route: routeId, colour, locos } = move as { route: number; colour: CardColour; locos: number };
      const problem = canClaim(next, seat, routeId);
      if (problem) return err("cannot-claim", problem);
      const route = mapOf(next).routes[routeId]!;
      if (!CARD_COLOURS.includes(colour)) return err("bad-colour", "That isn't a card colour.");
      if (route.color !== "gray" && route.color !== colour) {
        return err("wrong-colour", `That route needs ${route.color} cards.`);
      }
      if (locos < route.ferry) {
        return err("ferry", `That crossing needs at least ${route.ferry} locomotive${route.ferry === 1 ? "" : "s"}.`);
      }
      const coloured = route.len - locos;
      if (coloured < 0) return err("too-many", "That's more cards than the route is long.");
      if (hand[colour]! < coloured || hand.loco < locos) {
        return err("short", "You don't hold those cards.");
      }

      hand[colour]! -= coloured;
      hand.loco -= locos;
      // A tunnel payment stays on the table until the mountain has spoken —
      // discarding it early would let the reveal reshuffle it into the deck,
      // and there would be nothing left to hand back on a withdrawal.
      if (!route.tunnel) {
        for (let i = 0; i < coloured; i++) next.discard.push(colour);
        for (let i = 0; i < locos; i++) next.discard.push("loco");
      }

      if (route.tunnel) {
        // The commitment is made before the mountain has its say.
        const revealed: Card[] = [];
        for (let i = 0; i < 3; i++) {
          const card = drawCard(next);
          if (card) revealed.push(card);
        }
        const pureLoco = coloured === 0;
        const extra = revealed.filter((c) => (pureLoco ? c === "loco" : c === colour || c === "loco")).length;
        next.discard.push(...revealed);
        next.ply++;
        events.push({
          type: "tunnel",
          seat,
          text:
            extra > 0
              ? `The tunnel reveals ${revealed.join(", ")} — ${extra} more card${extra === 1 ? "" : "s"} needed.`
              : `The tunnel reveals ${revealed.join(", ")} — no extra cost.`,
          data: { revealed, extra },
          sfx: "reveal"
        });

        if (extra > 0) {
          next.tunnel = { seat, route: routeId, colour, locos, coloured, revealed, extra };
          next.pending.push({
            id: pendingId(next, "tunnel", seat),
            seat,
            kind: "tunnel",
            prompt: `The tunnel wants ${extra} more. Pay, or take everything back and end your turn.`
          });
          return ok({ state: next, events });
        }
        // No extra demanded: the payment settles into the discard as usual.
        for (let i = 0; i < coloured; i++) next.discard.push(colour);
        for (let i = 0; i < locos; i++) next.discard.push("loco");
      }

      finishClaim(next, seat, routeId, events);
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    case "tunnel-pay": {
      const t = next.tunnel;
      if (!t) return err("no-tunnel", "There's no tunnel waiting.");
      const { locos } = move as { locos: number };
      const coloured = t.extra - locos;
      if (locos < 0 || coloured < 0) return err("bad-payment", "That doesn't add up.");
      if (hand[t.colour]! < coloured || hand.loco < locos) {
        return err("short", "You can't cover the extra cost.");
      }
      hand[t.colour]! -= coloured;
      hand.loco -= locos;
      // Both the original payment and the extra go to the discard together.
      for (let i = 0; i < coloured + t.coloured; i++) next.discard.push(t.colour);
      for (let i = 0; i < locos + t.locos; i++) next.discard.push("loco");

      next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.tunnel = null;
      next.ply++;
      events.push({ type: "tunnel-paid", seat, text: `${next.names[seat]} pays the mountain.`, sfx: "trainClack" });
      finishClaim(next, seat, t.route, events);
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    case "tunnel-withdraw": {
      const t = next.tunnel;
      if (!t) return err("no-tunnel", "There's no tunnel waiting.");
      // Everything laid out comes back — and the turn is over anyway.
      hand[t.colour]! += t.coloured;
      hand.loco += t.locos;

      next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.tunnel = null;
      next.ply++;
      events.push({
        type: "tunnel-withdrawn",
        seat,
        text: `${next.names[seat]} backs out of the tunnel.`,
        sfx: "error"
      });
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    case "tickets": {
      if (next.ticketDeck.length === 0) return err("no-tickets", "The ticket pile is empty.");
      const offer: number[] = [];
      for (let i = 0; i < 3 && next.ticketDeck.length; i++) offer.push(next.ticketDeck.shift()!);
      next.offered[seat] = offer;
      next.pending.push({
        id: pendingId(next, "keep-tickets", seat),
        seat,
        kind: "keep-tickets",
        prompt: "Keep at least one."
      });
      next.ply++;
      events.push({
        type: "tickets-drawn",
        seat,
        text: `${next.names[seat]} takes ${offer.length} destination tickets.`,
        sfx: "cardSlip"
      });
      return ok({ state: next, events });
    }

    case "station": {
      const { city, colour, locos } = move as { city: string; colour: CardColour; locos: number };
      if ((next.stationsLeft[seat] ?? 0) <= 0) return err("no-stations", "You've built all three.");
      if (!mapOf(next).cities.some((c) => c.key === city)) return err("no-city", "There's no such city.");
      const taken = new Set(Object.values(next.stationCities).flat());
      if (taken.has(city)) return err("occupied", "That city already has a station.");
      const cost = 3 - next.stationsLeft[seat]! + 1;
      const coloured = cost - locos;
      if (coloured < 0 || hand[colour]! < coloured || hand.loco < locos) {
        return err("short", `A station there costs ${cost} card${cost === 1 ? "" : "s"} of one colour.`);
      }
      hand[colour]! -= coloured;
      hand.loco -= locos;
      for (let i = 0; i < coloured; i++) next.discard.push(colour);
      for (let i = 0; i < locos; i++) next.discard.push("loco");
      next.stationsLeft[seat]!--;
      next.stationCities[seat] = [...(next.stationCities[seat] ?? []), city];
      next.ply++;
      events.push({
        type: "station",
        seat,
        text: `${next.names[seat]} builds a station at ${cityName(next, city)}.`,
        data: { city },
        sfx: "tileSnap"
      });
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    case "pass": {
      if (legalMoves(state, seat).some((m) => m.kind !== "pass")) {
        return err("can-move", "You still have something you can do.");
      }
      next.drawsLeft = 0;
      next.ply++;
      events.push({ type: "pass", seat, text: `${next.names[seat]} can do nothing and passes.` });
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    default:
      return err("unknown-move", "That isn't a move this game understands.");
  }
}

function cityName(state: BoxcarState, key: string): string {
  return mapOf(state).cities.find((c) => c.key === key)?.name ?? key;
}

function finishClaim(state: BoxcarState, seat: SeatId, routeId: number, events: GameEvent[]): void {
  const route = mapOf(state).routes[routeId]!;
  state.claims[routeId] = seat;
  state.cars[seat]! -= route.len;
  const points = routePoints(route.len);
  state.routeScore[seat]! += points;
  events.push({
    type: "claim",
    seat,
    text: `${state.names[seat]} claims ${cityName(state, route.a)} – ${cityName(state, route.b)} for ${points}.`,
    data: { route: routeId, points },
    sfx: "claim"
  });
}

/** Pass the turn on, and start (or finish) the final lap. */
function endTurn(state: BoxcarState, seat: SeatId, events: GameEvent[]): void {
  state.drawsLeft = 0;

  if (!state.finalLap && (state.cars[seat] ?? 0) <= 2) {
    state.finalLap = true;
    // Everyone gets one more turn, including the player who triggered it.
    state.finalTurns = state.seatCount;
    events.push({
      type: "final-lap",
      seat,
      text: `${state.names[seat]} is down to ${state.cars[seat]} cars — one turn each remaining.`,
      sfx: "nudge"
    });
  }

  if (state.finalLap) {
    state.finalTurns--;
    if (state.finalTurns <= 0) {
      state.finished = true;
      events.push({ type: "game-end", text: "The last train has run.", sfx: "win" });
      return;
    }
  }
  state.turn = (seat + 1) % state.seatCount;
}

/* ---------------------------------------------------------------- scoring */

export interface SeatScore {
  routes: number;
  ticketsDone: number;
  ticketPoints: number;
  ticketPenalty: number;
  stations: number;
  longest: number;
  globetrotter: number;
  total: number;
  completed: number[];
  failed: number[];
}

/**
 * Ticket connectivity, with stations.
 *
 * A built station lets its owner borrow exactly one route of another player
 * that touches that city. Three stations is at most a few hundred combinations,
 * so the best set is found by trying them all rather than by guessing.
 */
export function bestNetwork(state: BoxcarState, seat: SeatId): { routeIds: number[]; net: number } {
  const map = mapOf(state);
  const own = Object.entries(state.claims)
    .filter(([, owner]) => owner === seat)
    .map(([id]) => Number(id));

  const stations = state.stationCities[seat] ?? [];
  const options: number[][] = stations.map((city) => {
    const borrowable = map.routes
      .filter((r) => (r.a === city || r.b === city) && state.claims[r.id] !== undefined && state.claims[r.id] !== seat)
      .map((r) => r.id);
    return [-1, ...borrowable]; // -1 = borrow nothing at this station
  });

  let best = { routeIds: own, net: ticketNet(state, seat, own) };
  const walk = (index: number, picked: number[]): void => {
    if (index === options.length) {
      const routeIds = [...own, ...picked.filter((id) => id >= 0)];
      const net = ticketNet(state, seat, routeIds);
      if (net > best.net) best = { routeIds, net };
      return;
    }
    for (const choice of options[index]!) walk(index + 1, [...picked, choice]);
  };
  walk(0, []);
  return best;
}

function ticketNet(state: BoxcarState, seat: SeatId, routeIds: number[]): number {
  const map = mapOf(state);
  let net = 0;
  for (const id of state.tickets[seat] ?? []) {
    const ticket = map.tickets[id]!;
    net += citiesConnected(map, routeIds, ticket.a, ticket.b) ? ticket.points : -ticket.points;
  }
  return net;
}

export function scoreSeat(state: BoxcarState, seat: SeatId, longestHolders: SeatId[], mostTickets: SeatId[]): SeatScore {
  const map = mapOf(state);
  const { routeIds } = bestNetwork(state, seat);
  const completed: number[] = [];
  const failed: number[] = [];
  let ticketPoints = 0;
  let ticketPenalty = 0;

  for (const id of state.tickets[seat] ?? []) {
    const ticket = map.tickets[id]!;
    if (citiesConnected(map, routeIds, ticket.a, ticket.b)) {
      completed.push(id);
      ticketPoints += ticket.points;
    } else {
      failed.push(id);
      ticketPenalty += ticket.points;
    }
  }

  const stations = (state.stationsLeft[seat] ?? 0) * 4;
  const longest = longestHolders.includes(seat) ? 10 : 0;
  const globetrotter = state.globetrotter && mostTickets.includes(seat) ? 10 : 0;
  const routes = state.routeScore[seat] ?? 0;

  return {
    routes,
    ticketsDone: completed.length,
    ticketPoints,
    ticketPenalty,
    stations,
    longest,
    globetrotter,
    total: routes + ticketPoints - ticketPenalty + stations + longest + globetrotter,
    completed,
    failed
  };
}

export function fullScores(state: BoxcarState): Record<SeatId, SeatScore> {
  const map = mapOf(state);
  const seats = Object.keys(state.hands).map(Number);

  const trails = seats.map((seat) => {
    const own = Object.entries(state.claims)
      .filter(([, owner]) => owner === seat)
      .map(([id]) => Number(id));
    return { seat, length: longestTrail(map, own) };
  });
  const bestTrail = Math.max(0, ...trails.map((t) => t.length));
  const longestHolders = trails.filter((t) => t.length === bestTrail && bestTrail > 0).map((t) => t.seat);

  // Globetrotter needs the completed counts, which need the networks.
  const done = seats.map((seat) => {
    const { routeIds } = bestNetwork(state, seat);
    const count = (state.tickets[seat] ?? []).filter((id) => {
      const t = map.tickets[id]!;
      return citiesConnected(map, routeIds, t.a, t.b);
    }).length;
    return { seat, count };
  });
  const mostCount = Math.max(0, ...done.map((d) => d.count));
  const mostTickets = done.filter((d) => d.count === mostCount && mostCount > 0).map((d) => d.seat);

  const out: Record<SeatId, SeatScore> = {};
  for (const seat of seats) out[seat] = scoreSeat(state, seat, longestHolders, mostTickets);
  return out;
}

export function isTerminal(state: BoxcarState): boolean {
  return state.finished;
}

export function score(state: BoxcarState): FinalScore[] {
  const detail = fullScores(state);
  const entries = Object.keys(detail)
    .map(Number)
    .map((seat) => {
      const s = detail[seat]!;
      return {
        seat,
        total: s.total,
        lines: [
          { label: "Routes", value: s.routes },
          { label: "Tickets", value: s.ticketPoints },
          { label: "Missed tickets", value: -s.ticketPenalty },
          { label: "Stations", value: s.stations },
          { label: "Longest line", value: s.longest },
          ...(state.globetrotter ? [{ label: "Globetrotter", value: s.globetrotter }] : [])
        ]
      };
    });
  // Ties go to whoever completed more tickets.
  return rankScores(entries, (a, b) => (detail[b]!.ticketsDone ?? 0) - (detail[a]!.ticketsDone ?? 0));
}

/* -------------------------------------------------------------- redaction */

export interface BoxcarView {
  mapId: string;
  market: (Card | null)[];
  deckCount: number;
  discardCount: number;
  ticketDeckCount: number;
  claims: Record<number, SeatId>;
  /** Your hand. Everyone else's is a count. */
  hand: Hand;
  handCounts: Record<SeatId, number>;
  /** Your tickets, with a live completed flag. Others' are counts only. */
  tickets: { id: number; a: string; b: string; points: number; long: boolean; done: boolean }[];
  ticketCounts: Record<SeatId, number>;
  /** Tickets you are being asked to keep. */
  offered: { id: number; a: string; b: string; points: number; long: boolean }[];
  cars: Record<SeatId, number>;
  stationsLeft: Record<SeatId, number>;
  stationCities: Record<SeatId, string[]>;
  routeScore: Record<SeatId, number>;
  names: Record<SeatId, string>;
  turn: SeatId;
  drawsLeft: number;
  drafting: boolean;
  finalLap: boolean;
  finished: boolean;
  seat: SeatId | "spectator";
  pending: { kind: string; prompt?: string } | null;
  tunnel: { revealed: Card[]; extra: number } | null;
}

export function redactStateFor(state: BoxcarState, viewer: SeatId | "spectator"): BoxcarView {
  const map = mapOf(state);
  const handCounts: Record<SeatId, number> = {};
  const ticketCounts: Record<SeatId, number> = {};
  for (const key of Object.keys(state.hands).map(Number)) {
    handCounts[key] = handSize(state.hands[key]!);
    ticketCounts[key] = (state.tickets[key] ?? []).length;
  }

  const mine = viewer === "spectator" ? [] : (state.tickets[viewer] ?? []);
  const network = viewer === "spectator" ? { routeIds: [] as number[] } : bestNetwork(state, viewer);
  const open = viewer === "spectator" ? undefined : state.pending.filter((p) => p.seat === viewer).at(-1);

  return {
    mapId: state.mapId,
    market: state.market.slice(),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    ticketDeckCount: state.ticketDeck.length,
    claims: { ...state.claims },
    hand: viewer === "spectator" ? ({} as Hand) : { ...state.hands[viewer]! },
    handCounts,
    tickets: mine.map((id) => {
      const t = map.tickets[id]!;
      return {
        id,
        a: t.a,
        b: t.b,
        points: t.points,
        long: t.long,
        done: citiesConnected(map, network.routeIds, t.a, t.b)
      };
    }),
    ticketCounts,
    offered:
      viewer === "spectator"
        ? []
        : (state.offered[viewer] ?? []).map((id) => {
            const t = map.tickets[id]!;
            return { id, a: t.a, b: t.b, points: t.points, long: t.long };
          }),
    cars: { ...state.cars },
    stationsLeft: { ...state.stationsLeft },
    stationCities: clone(state.stationCities),
    routeScore: { ...state.routeScore },
    names: { ...state.names },
    turn: state.turn,
    drawsLeft: state.drawsLeft,
    drafting: state.drafting,
    finalLap: state.finalLap,
    finished: state.finished,
    seat: viewer,
    pending: open ? { kind: open.kind, prompt: open.prompt } : null,
    tunnel:
      state.tunnel && state.tunnel.seat === viewer
        ? { revealed: state.tunnel.revealed.slice(), extra: state.tunnel.extra }
        : null
  };
}

export function describeMove(state: BoxcarState, _seat: SeatId, move: BoxcarMove): string {
  switch (move.kind) {
    case "draw": return move.from === "deck" ? "draws blind" : "takes a face-up card";
    case "claim": return `claims route ${move.route}`;
    case "tickets": return "draws tickets";
    case "keep": return `keeps ${move.ids.length} tickets`;
    case "station": return `builds a station at ${cityName(state, move.city)}`;
    case "tunnel-pay": return "pays the tunnel";
    case "tunnel-withdraw": return "backs out of the tunnel";
    default: return "passes";
  }
}

/** Cards and cars are conserved; nobody owns both halves of a double. */
export function invariants(state: BoxcarState): string | void {
  let cards = state.deck.length + state.discard.length + state.market.filter(Boolean).length;
  for (const hand of Object.values(state.hands)) cards += handSize(hand);
  // A tunnel payment sits on the table while the mountain is being consulted:
  // out of the hand, not yet in the discard, but very much still in the game.
  if (state.tunnel) cards += state.tunnel.coloured + state.tunnel.locos;
  if (cards !== 110) return `train-card count is ${cards}, should be 110`;

  const map = mapOf(state);
  for (const [id, owner] of Object.entries(state.claims)) {
    const route = map.routes[Number(id)]!;
    if (route.twin !== undefined && state.claims[route.twin] === owner) {
      return "a player owns both tracks of a double route";
    }
    if (state.seatCount <= 3 && route.twin !== undefined && state.claims[route.twin] !== undefined) {
      return "both tracks of a double are claimed at a small table";
    }
  }

  for (const seat of Object.keys(state.cars).map(Number)) {
    const spent = Object.entries(state.claims)
      .filter(([, owner]) => owner === seat)
      .reduce((n, [id]) => n + map.routes[Number(id)]!.len, 0);
    if (state.cars[seat] !== state.carsPerPlayer - spent) {
      return `seat ${seat} has ${state.cars[seat]} cars but has spent ${spent}`;
    }
    if ((state.cars[seat] ?? 0) < 0) return "a player has negative cars";
  }
  return undefined;
}
