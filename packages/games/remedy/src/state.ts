/**
 * Remedy — beat the board, together.
 *
 * The board takes a turn too: after every player turn it draws infection cards,
 * and an epidemic makes it worse in three ways at once. Everything the team
 * knows is public — this is a co-op, and hiding your hand from your own side
 * would only make the game slower — but the decks stay face down, which is the
 * only uncertainty the game needs.
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
  CITIES,
  CUBES_PER_ZONE,
  EPIDEMICS,
  HAND_LIMIT,
  HUB,
  INFECTION_RATES,
  MAX_LABS,
  OUTBREAK_LIMIT,
  STARTING_HAND,
  ZONES,
  cityById,
  zoneOf,
  type Role,
  type Zone
} from "./world";

export const configSchema = z.object({
  difficulty: z.enum(["introductory", "standard", "heroic"]).default("standard")
});

export type RemedyConfig = z.infer<typeof configSchema>;

export type RemedyMove =
  | { kind: "drive"; to: number }
  | { kind: "direct"; to: number }
  | { kind: "charter"; to: number }
  | { kind: "shuttle"; to: number }
  | { kind: "engineer-flight"; to: number; card: number }
  | { kind: "build" }
  | { kind: "treat"; zone: Zone }
  | { kind: "share"; with: SeatId; card: number; give: boolean }
  | { kind: "cure"; zone: Zone; cards: number[] }
  | { kind: "courier-move"; pawn: SeatId; to: number }
  | { kind: "consent"; agree: boolean }
  | { kind: "discard"; card: number }
  | { kind: "end-turn" };

export interface RemedyState extends BaseState {
  /** Cubes on each city, by zone colour. */
  cubes: Record<number, Record<Zone, number>>;
  labs: number[];
  positions: Record<SeatId, number>;
  roles: Record<SeatId, Role>;
  hands: Record<SeatId, number[]>;
  playerDeck: (number | "epidemic")[];
  playerDiscard: number[];
  infectionDeck: number[];
  infectionDiscard: number[];
  supply: Record<Zone, number>;
  cured: Record<Zone, boolean>;
  eradicated: Record<Zone, boolean>;
  outbreaks: number;
  infectionRateIndex: number;
  names: Record<SeatId, string>;
  turn: SeatId;
  actionsLeft: number;
  /** The engineer's once-a-turn flight. */
  engineerFlightUsed: boolean;
  /** A courier's request, waiting on the other player's say-so. */
  request: { by: SeatId; pawn: SeatId; to: number } | null;
  outcome: "won" | "lost" | null;
  lostBecause: string | null;
  finished: boolean;
}

const emptyCubes = (): Record<Zone, number> => ({ amber: 0, cobalt: 0, verdant: 0, rust: 0 });

export function createState(config: RemedyConfig, seats: Seat[], seed: string): RemedyState {
  const rng = new Rng(seed);
  const cubes: Record<number, Record<Zone, number>> = {};
  for (const city of CITIES) cubes[city.id] = emptyCubes();

  const roles: Record<SeatId, Role> = {};
  const names: Record<SeatId, string> = {};
  const positions: Record<SeatId, number> = {};
  const hands: Record<SeatId, number[]> = {};
  const allRoles: Role[] = rng.shuffle(["medic", "scientist", "courier", "engineer", "analyst"]);
  seats.forEach((seat, i) => {
    roles[seat.id] = allRoles[i % allRoles.length]!;
    names[seat.id] = seat.name;
    positions[seat.id] = HUB;
    hands[seat.id] = [];
  });

  const state: RemedyState = {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    cubes,
    labs: [HUB],
    positions,
    roles,
    hands,
    playerDeck: [],
    playerDiscard: [],
    infectionDeck: rng.shuffle(CITIES.map((c) => c.id)),
    infectionDiscard: [],
    supply: { amber: CUBES_PER_ZONE, cobalt: CUBES_PER_ZONE, verdant: CUBES_PER_ZONE, rust: CUBES_PER_ZONE },
    cured: { amber: false, cobalt: false, verdant: false, rust: false },
    eradicated: { amber: false, cobalt: false, verdant: false, rust: false },
    outbreaks: 0,
    infectionRateIndex: 0,
    names,
    turn: seats[0]!.id,
    actionsLeft: 4,
    engineerFlightUsed: false,
    request: null,
    outcome: null,
    lostBecause: null,
    finished: false
  };
  state.rng = rng.serialize();

  // The opening outbreak: three cities badly, three moderately, three lightly.
  for (const amount of [3, 3, 3, 2, 2, 2, 1, 1, 1]) {
    const city = state.infectionDeck.shift();
    if (city === undefined) break;
    state.infectionDiscard.push(city);
    const zone = zoneOf(city);
    const given = Math.min(amount, state.supply[zone]);
    state.cubes[city]![zone] += given;
    state.supply[zone] -= given;
  }

  // The player deck: every city card, dealt out, then cut into piles with an
  // epidemic buried in each. That is why the game gets worse as it goes on.
  const deal = STARTING_HAND[seats.length] ?? 2;
  const cards = new Rng(`${seed}:player`).shuffle(CITIES.map((c) => c.id));
  let cursor = 0;
  for (const seat of seats) {
    hands[seat.id] = cards.slice(cursor, cursor + deal);
    cursor += deal;
  }
  const remaining: (number | "epidemic")[] = cards.slice(cursor);
  const epidemics = EPIDEMICS[config.difficulty] ?? 5;
  const piles: (number | "epidemic")[][] = Array.from({ length: epidemics }, () => []);
  remaining.forEach((card, i) => piles[i % epidemics]!.push(card));
  const shuffler = new Rng(`${seed}:piles`);
  state.playerDeck = piles.flatMap((pile) => shuffler.shuffle([...pile, "epidemic" as const]));

  return state;
}

export const rateOf = (state: RemedyState): number =>
  INFECTION_RATES[Math.min(state.infectionRateIndex, INFECTION_RATES.length - 1)]!;

export const cubesOn = (state: RemedyState, city: number, zone: Zone): number =>
  state.cubes[city]?.[zone] ?? 0;

export function currentSeats(state: RemedyState): SeatId[] {
  if (state.finished) return [];
  if (state.pending.length) return [state.pending.at(-1)!.seat];
  return [state.turn];
}

/* ------------------------------------------------------------ legal moves */

export function legalMoves(state: RemedyState, seat: SeatId): RemedyMove[] {
  if (state.finished) return [];

  const open = state.pending.at(-1);
  if (open) {
    if (open.seat !== seat) return [];
    if (open.kind === "discard") {
      return (state.hands[seat] ?? []).map((card) => ({ kind: "discard" as const, card }));
    }
    if (open.kind === "consent") {
      return [
        { kind: "consent", agree: true },
        { kind: "consent", agree: false }
      ];
    }
    return [];
  }

  if (state.turn !== seat) return [];
  const moves: RemedyMove[] = [];
  const here = state.positions[seat]!;
  const hand = state.hands[seat] ?? [];
  const role = state.roles[seat]!;

  if (state.actionsLeft <= 0) return [{ kind: "end-turn" }];

  for (const to of cityById(here).links) moves.push({ kind: "drive", to });
  for (const card of hand) {
    if (card !== here) moves.push({ kind: "direct", to: card });
  }
  if (hand.includes(here)) {
    for (const city of CITIES) {
      if (city.id !== here) moves.push({ kind: "charter", to: city.id });
    }
  }
  if (state.labs.includes(here)) {
    for (const lab of state.labs) if (lab !== here) moves.push({ kind: "shuttle", to: lab });
  }
  if (role === "engineer" && !state.engineerFlightUsed && state.labs.includes(here) && hand.length > 0) {
    for (const card of hand) {
      for (const city of CITIES) {
        if (city.id !== here) moves.push({ kind: "engineer-flight", to: city.id, card });
      }
    }
  }

  if (!state.labs.includes(here) && state.labs.length < MAX_LABS) {
    if (role === "engineer" || hand.includes(here)) moves.push({ kind: "build" });
  }

  for (const zone of ZONES) {
    if (cubesOn(state, here, zone) > 0) moves.push({ kind: "treat", zone });
  }

  for (const other of Object.keys(state.positions).map(Number)) {
    if (other === seat) continue;
    if (state.positions[other] !== here) continue;
    const analyst = role === "analyst" || state.roles[other] === "analyst";
    for (const card of hand) {
      if (analyst || card === here) moves.push({ kind: "share", with: other, card, give: true });
    }
    for (const card of state.hands[other] ?? []) {
      if (analyst || card === here) moves.push({ kind: "share", with: other, card, give: false });
    }
  }

  if (state.labs.includes(here)) {
    const need = role === "scientist" ? 4 : 5;
    for (const zone of ZONES) {
      if (state.cured[zone]) continue;
      const matching = hand.filter((card) => zoneOf(card) === zone);
      if (matching.length >= need) moves.push({ kind: "cure", zone, cards: matching.slice(0, need) });
    }
  }

  if (role === "courier") {
    for (const other of Object.keys(state.positions).map(Number)) {
      if (other === seat) continue;
      const from = state.positions[other]!;
      // With their say-so, move them as if they were you…
      for (const to of cityById(from).links) moves.push({ kind: "courier-move", pawn: other, to });
      // …or move any pawn between laboratories, which needs nobody's leave.
      if (state.labs.includes(from)) {
        for (const lab of state.labs) if (lab !== from) moves.push({ kind: "courier-move", pawn: other, to: lab });
      }
    }
  }

  moves.push({ kind: "end-turn" });
  return moves;
}

/* --------------------------------------------------------------- applying */

export function applyMove(
  state: RemedyState,
  seat: SeatId,
  move: RemedyMove
): Result<{ state: RemedyState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  const kind = (move as { kind?: string })?.kind;
  const open = state.pending.at(-1);

  if (open) {
    if (open.seat !== seat) return err("not-your-turn", "Someone else is deciding.");
    if (open.kind === "discard" && kind !== "discard") return err("must-discard", "Discard down to seven first.");
    if (open.kind === "consent" && kind !== "consent") return err("must-answer", "Answer the courier first.");
  } else if (state.turn !== seat) {
    return err("not-your-turn", "Wait for your turn.");
  }

  const next = clone(state);
  const events: GameEvent[] = [];
  const hand = next.hands[seat] ?? [];
  const role = next.roles[seat]!;
  const here = next.positions[seat]!;

  const spend = (): void => {
    next.actionsLeft--;
    next.ply++;
  };
  const discardCard = (card: number): void => {
    const i = hand.indexOf(card);
    if (i >= 0) hand.splice(i, 1);
    next.playerDiscard.push(card);
  };

  switch (kind) {
    case "discard": {
      const { card } = move as { card: number };
      if (!hand.includes(card)) return err("not-held", "You don't hold that card.");
      discardCard(card);
      if (hand.length <= HAND_LIMIT) next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.ply++;
      events.push({ type: "discard", seat, text: `${next.names[seat]} discards a card.`, sfx: "cardSlip" });
      // A turn that ended while somebody was still over the limit resumes here.
      if (next.pending.length === 0 && next.actionsLeft <= 0) advanceTurn(next, next.turn);
      return ok({ state: next, events });
    }

    case "consent": {
      const request = next.request;
      if (!request) return err("nothing-asked", "Nobody asked you anything.");
      const { agree } = move as { agree: boolean };
      next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.request = null;
      next.ply++;
      if (agree) {
        next.positions[request.pawn] = request.to;
        medicSweep(next, request.pawn, events);
        events.push({
          type: "courier",
          seat,
          text: `${next.names[request.pawn]} is carried to ${cityById(request.to).name}.`,
          sfx: "swoosh"
        });
      } else {
        events.push({ type: "refused", seat, text: `${next.names[seat]} stays put.` });
      }
      if (next.actionsLeft <= 0 && next.pending.length === 0) endTurn(next, request.by, events);
      return ok({ state: next, events });
    }

    case "drive": {
      const { to } = move as { to: number };
      if (!cityById(here).links.includes(to)) return err("no-road", "There's no road that way.");
      next.positions[seat] = to;
      spend();
      medicSweep(next, seat, events);
      events.push({ type: "move", seat, text: `${next.names[seat]} drives to ${cityById(to).name}.`, sfx: "pieceSet" });
      break;
    }

    case "direct": {
      const { to } = move as { to: number };
      if (!hand.includes(to)) return err("no-card", "You need that city's card to fly there.");
      discardCard(to);
      next.positions[seat] = to;
      spend();
      medicSweep(next, seat, events);
      events.push({ type: "move", seat, text: `${next.names[seat]} flies to ${cityById(to).name}.`, sfx: "swoosh" });
      break;
    }

    case "charter": {
      const { to } = move as { to: number };
      if (!hand.includes(here)) return err("no-card", "A charter costs the card of the city you're in.");
      discardCard(here);
      next.positions[seat] = to;
      spend();
      medicSweep(next, seat, events);
      events.push({ type: "move", seat, text: `${next.names[seat]} charters to ${cityById(to).name}.`, sfx: "swoosh" });
      break;
    }

    case "shuttle": {
      const { to } = move as { to: number };
      if (!next.labs.includes(here) || !next.labs.includes(to)) {
        return err("no-lab", "A shuttle runs between laboratories.");
      }
      next.positions[seat] = to;
      spend();
      medicSweep(next, seat, events);
      events.push({ type: "move", seat, text: `${next.names[seat]} shuttles to ${cityById(to).name}.`, sfx: "swoosh" });
      break;
    }

    case "engineer-flight": {
      if (role !== "engineer") return err("not-engineer", "Only the engineer can do that.");
      if (next.engineerFlightUsed) return err("used", "You've already taken that flight this turn.");
      if (!next.labs.includes(here)) return err("no-lab", "That flight leaves from a laboratory.");
      const { to, card } = move as { to: number; card: number };
      if (!hand.includes(card)) return err("no-card", "You don't hold that card.");
      discardCard(card);
      next.positions[seat] = to;
      next.engineerFlightUsed = true;
      spend();
      medicSweep(next, seat, events);
      events.push({
        type: "move",
        seat,
        text: `${next.names[seat]} takes the works flight to ${cityById(to).name}.`,
        sfx: "swoosh"
      });
      break;
    }

    case "build": {
      if (next.labs.includes(here)) return err("already", "There's already a laboratory here.");
      if (next.labs.length >= MAX_LABS) return err("no-labs", "There are no laboratories left to build.");
      if (role !== "engineer") {
        if (!hand.includes(here)) return err("no-card", "Building costs the card of the city you're in.");
        discardCard(here);
      }
      next.labs.push(here);
      spend();
      events.push({
        type: "build",
        seat,
        text: `${next.names[seat]} raises a laboratory in ${cityById(here).name}.`,
        sfx: "tileSnap"
      });
      break;
    }

    case "treat": {
      const { zone } = move as { zone: Zone };
      const on = cubesOn(next, here, zone);
      if (on <= 0) return err("nothing-there", "There's nothing of that colour here.");
      // The medic clears a city in one go; so does anybody, once it is cured.
      const removed = role === "medic" || next.cured[zone] ? on : 1;
      next.cubes[here]![zone] -= removed;
      next.supply[zone] += removed;
      spend();
      events.push({
        type: "treat",
        seat,
        text: `${next.names[seat]} treats ${removed} in ${cityById(here).name}.`,
        sfx: "cure"
      });
      checkEradication(next, zone, events);
      break;
    }

    case "share": {
      const { with: other, card, give } = move as { with: SeatId; card: number; give: boolean };
      if (next.positions[other] !== here) return err("apart", "You have to be in the same city.");
      const analyst = role === "analyst" || next.roles[other] === "analyst";
      if (!analyst && card !== here) return err("wrong-card", "Only the card of the city you're standing in.");
      const from = give ? hand : (next.hands[other] ?? []);
      const to = give ? (next.hands[other] ?? []) : hand;
      const i = from.indexOf(card);
      if (i < 0) return err("not-held", "That card isn't there to give.");
      from.splice(i, 1);
      to.push(card);
      spend();
      events.push({
        type: "share",
        seat,
        text: `${next.names[seat]} ${give ? "hands" : "takes"} a card ${give ? "to" : "from"} ${next.names[other]}.`,
        sfx: "cardSlip"
      });
      if (to.length > HAND_LIMIT) askDiscard(next, give ? other : seat);
      break;
    }

    case "cure": {
      const { zone, cards } = move as { zone: Zone; cards: number[] };
      if (!next.labs.includes(here)) return err("no-lab", "Cures are found in a laboratory.");
      if (next.cured[zone]) return err("already-cured", "That one is already cured.");
      const need = role === "scientist" ? 4 : 5;
      if (!Array.isArray(cards) || cards.length !== need) return err("wrong-count", `That takes ${need} cards.`);
      if (!cards.every((c) => hand.includes(c) && zoneOf(c) === zone)) {
        return err("wrong-cards", "Those aren't the right cards.");
      }
      for (const card of cards) discardCard(card);
      next.cured[zone] = true;
      spend();
      events.push({
        type: "cure",
        seat,
        text: `${next.names[seat]} finds the cure for ${zone}.`,
        data: { zone },
        sfx: "cure"
      });
      checkEradication(next, zone, events);

      if (ZONES.every((z) => next.cured[z])) {
        next.finished = true;
        next.outcome = "won";
        events.push({ type: "won", text: "Every affliction is cured. The world holds.", sfx: "win" });
        return ok({ state: next, events });
      }
      break;
    }

    case "courier-move": {
      if (role !== "courier") return err("not-courier", "Only the courier can move somebody else.");
      const { pawn, to } = move as { pawn: SeatId; to: number };
      if (pawn === seat) return err("yourself", "Move yourself the ordinary way.");
      const from = next.positions[pawn];
      if (from === undefined) return err("no-pawn", "There's nobody there to move.");
      const bothLabs = next.labs.includes(from) && next.labs.includes(to);
      if (!bothLabs && !cityById(from).links.includes(to)) {
        return err("no-road", "There's no road that way.");
      }
      if (bothLabs) {
        // Laboratory to laboratory needs nobody's permission.
        next.positions[pawn] = to;
        spend();
        medicSweep(next, pawn, events);
        events.push({
          type: "courier",
          seat,
          text: `${next.names[seat]} routes ${next.names[pawn]} to ${cityById(to).name}.`,
          sfx: "swoosh"
        });
        break;
      }
      next.request = { by: seat, pawn, to };
      next.pending.push({
        id: pendingId(next, "consent", pawn),
        seat: pawn,
        kind: "consent",
        prompt: `${next.names[seat]} wants to move you to ${cityById(to).name}.`
      });
      // Asking costs the action whatever the answer is — otherwise a courier
      // could stand there asking all day.
      spend();
      events.push({
        type: "request",
        seat,
        text: `${next.names[seat]} asks ${next.names[pawn]} to move.`,
        sfx: "nudge"
      });
      return ok({ state: next, events });
    }

    case "end-turn": {
      next.ply++;
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    default:
      return err("unknown-move", "That isn't a move this game understands.");
  }

  if (next.actionsLeft <= 0 && next.pending.length === 0) endTurn(next, seat, events);
  return ok({ state: next, events });
}

/** The medic's passing gift: a cured colour clears itself wherever they stand. */
function medicSweep(state: RemedyState, seat: SeatId, events: GameEvent[]): void {
  if (state.roles[seat] !== "medic") return;
  const here = state.positions[seat]!;
  for (const zone of ZONES) {
    if (!state.cured[zone]) continue;
    const on = cubesOn(state, here, zone);
    if (on <= 0) continue;
    state.cubes[here]![zone] = 0;
    state.supply[zone] += on;
    events.push({
      type: "treat",
      seat,
      text: `The medic clears ${cityById(here).name} on arrival.`,
      sfx: "cure"
    });
    checkEradication(state, zone, events);
  }
}

function checkEradication(state: RemedyState, zone: Zone, events: GameEvent[]): void {
  if (!state.cured[zone] || state.eradicated[zone]) return;
  const anyLeft = CITIES.some((c) => cubesOn(state, c.id, zone) > 0);
  if (anyLeft) return;
  state.eradicated[zone] = true;
  events.push({ type: "eradicated", text: `${zone} is wiped out entirely.`, sfx: "win" });
}

function askDiscard(state: RemedyState, seat: SeatId): void {
  if ((state.hands[seat] ?? []).length <= HAND_LIMIT) return;
  if (state.pending.some((p) => p.kind === "discard" && p.seat === seat)) return;
  state.pending.push({
    id: pendingId(state, "discard", seat),
    seat,
    kind: "discard",
    prompt: `You're holding ${(state.hands[seat] ?? []).length}. Discard down to ${HAND_LIMIT}.`
  });
}

/* ------------------------------------------------------------- the board */

function endTurn(state: RemedyState, seat: SeatId, events: GameEvent[]): void {
  drawPlayerCards(state, seat, events);
  if (state.finished) return;
  infect(state, events);
  if (state.finished) return;

  if (state.pending.some((p) => p.kind === "discard")) {
    // The hand limit is settled before the next player starts.
    state.actionsLeft = 0;
    return;
  }
  advanceTurn(state, seat);
}

function advanceTurn(state: RemedyState, seat: SeatId): void {
  state.turn = (seat + 1) % state.seatCount;
  state.actionsLeft = 4;
  state.engineerFlightUsed = false;
}

function drawPlayerCards(state: RemedyState, seat: SeatId, events: GameEvent[]): void {
  for (let i = 0; i < 2; i++) {
    const card = state.playerDeck.shift();
    if (card === undefined) {
      state.finished = true;
      state.outcome = "lost";
      state.lostBecause = "The player deck ran out before the cures were found.";
      events.push({ type: "lost", text: state.lostBecause, sfx: "lose" });
      return;
    }
    if (card === "epidemic") {
      epidemic(state, events);
      if (state.finished) return;
      continue;
    }
    state.hands[seat] = [...(state.hands[seat] ?? []), card];
  }
  askDiscard(state, seat);
}

function epidemic(state: RemedyState, events: GameEvent[]): void {
  // Worse in three ways: faster, somewhere new and badly, and then all the old
  // cities come back to the top of the deck.
  state.infectionRateIndex++;
  const bottom = state.infectionDeck.pop();
  events.push({ type: "epidemic", text: "An epidemic.", sfx: "outbreak" });

  if (bottom !== undefined) {
    state.infectionDiscard.push(bottom);
    addCubes(state, bottom, zoneOf(bottom), 3, new Set(), events);
  }
  const rng = Rng.from(state.rng);
  state.infectionDeck = [...rng.shuffle(state.infectionDiscard), ...state.infectionDeck];
  state.rng = rng.serialize();
  state.infectionDiscard = [];
}

function infect(state: RemedyState, events: GameEvent[]): void {
  const draws = rateOf(state);
  for (let i = 0; i < draws; i++) {
    const card = state.infectionDeck.shift();
    if (card === undefined) return;
    state.infectionDiscard.push(card);
    const zone = zoneOf(card);
    if (state.eradicated[zone]) continue;
    addCubes(state, card, zone, 1, new Set(), events);
    if (state.finished) return;
  }
}

/**
 * Cubes go on. A fourth one instead sets off an outbreak, which pushes a cube
 * into every neighbour — and those can chain, though no city outbreaks twice in
 * the same resolution.
 */
function addCubes(
  state: RemedyState,
  city: number,
  zone: Zone,
  amount: number,
  alreadyOutbroken: Set<number>,
  events: GameEvent[]
): void {
  for (let i = 0; i < amount; i++) {
    const on = cubesOn(state, city, zone);
    if (on >= 3) {
      if (alreadyOutbroken.has(city)) continue;
      alreadyOutbroken.add(city);
      state.outbreaks++;
      events.push({
        type: "outbreak",
        text: `${cityById(city).name} breaks out.`,
        data: { city, zone },
        sfx: "outbreak"
      });
      if (state.outbreaks >= OUTBREAK_LIMIT) {
        state.finished = true;
        state.outcome = "lost";
        state.lostBecause = "The eighth outbreak. It is out of hand.";
        events.push({ type: "lost", text: state.lostBecause, sfx: "lose" });
        return;
      }
      for (const neighbour of cityById(city).links) {
        addCubes(state, neighbour, zone, 1, alreadyOutbroken, events);
        if (state.finished) return;
      }
      continue;
    }

    if (state.supply[zone] <= 0) {
      state.finished = true;
      state.outcome = "lost";
      state.lostBecause = `There are no ${zone} cubes left anywhere.`;
      events.push({ type: "lost", text: state.lostBecause, sfx: "lose" });
      return;
    }
    state.cubes[city]![zone]++;
    state.supply[zone]--;
    events.push({
      type: "infect",
      text: `${cityById(city).name} takes a cube.`,
      data: { city, zone },
      sfx: "cubePlace"
    });
  }
}

export function isTerminal(state: RemedyState): boolean {
  return state.finished;
}

export function score(state: RemedyState): FinalScore[] {
  const cures = ZONES.filter((z) => state.cured[z]).length;
  const won = state.outcome === "won";
  const entries = Object.keys(state.positions)
    .map(Number)
    .map((seat) => ({
      seat,
      total: won ? 100 : cures * 10,
      lines: [
        { label: "Cures found", value: cures },
        { label: "Outbreaks", value: -state.outbreaks },
        { label: "Eradicated", value: ZONES.filter((z) => state.eradicated[z]).length }
      ]
    }));
  const ranked = rankScores(entries);
  // A co-op wins or loses together: everyone shares the result.
  for (const r of ranked) {
    r.won = won;
    r.rank = 1;
  }
  return ranked;
}

/* -------------------------------------------------------------- redaction */

export interface RemedyView {
  cubes: Record<number, Record<Zone, number>>;
  labs: number[];
  positions: Record<SeatId, number>;
  roles: Record<SeatId, Role>;
  /** Everyone's hand: this is a co-op, and the team plans out loud. */
  hands: Record<SeatId, number[]>;
  supply: Record<Zone, number>;
  cured: Record<Zone, boolean>;
  eradicated: Record<Zone, boolean>;
  outbreaks: number;
  outbreakLimit: number;
  infectionRate: number;
  playerDeckCount: number;
  /** The infection discard is face up, and reading it is half the game. */
  infectionDiscard: number[];
  infectionDeckCount: number;
  names: Record<SeatId, string>;
  turn: SeatId;
  actionsLeft: number;
  request: { by: SeatId; pawn: SeatId; to: number } | null;
  outcome: "won" | "lost" | null;
  lostBecause: string | null;
  finished: boolean;
  seat: SeatId | "spectator";
  pending: { kind: string; prompt?: string } | null;
}

export function redactStateFor(state: RemedyState, viewer: SeatId | "spectator"): RemedyView {
  const open = viewer === "spectator" ? undefined : state.pending.filter((p) => p.seat === viewer).at(-1);
  return {
    cubes: clone(state.cubes),
    labs: state.labs.slice(),
    positions: { ...state.positions },
    roles: { ...state.roles },
    hands: clone(state.hands),
    supply: { ...state.supply },
    cured: { ...state.cured },
    eradicated: { ...state.eradicated },
    outbreaks: state.outbreaks,
    outbreakLimit: OUTBREAK_LIMIT,
    infectionRate: rateOf(state),
    // The decks stay face down: their order is the only thing the team does not
    // get to know, and it is the only uncertainty the game needs.
    playerDeckCount: state.playerDeck.length,
    infectionDiscard: state.infectionDiscard.slice(),
    infectionDeckCount: state.infectionDeck.length,
    names: { ...state.names },
    turn: state.turn,
    actionsLeft: state.actionsLeft,
    request: state.request ? { ...state.request } : null,
    outcome: state.outcome,
    lostBecause: state.lostBecause,
    finished: state.finished,
    seat: viewer,
    pending: open ? { kind: open.kind, prompt: open.prompt } : null
  };
}

export function describeMove(_state: RemedyState, _seat: SeatId, move: RemedyMove): string {
  switch (move.kind) {
    case "drive": return `drives to ${cityById(move.to).name}`;
    case "direct": return `flies to ${cityById(move.to).name}`;
    case "charter": return `charters to ${cityById(move.to).name}`;
    case "shuttle": return `shuttles to ${cityById(move.to).name}`;
    case "build": return "builds a laboratory";
    case "treat": return `treats ${move.zone}`;
    case "cure": return `cures ${move.zone}`;
    case "share": return "shares knowledge";
    default: return move.kind.replace("-", " ");
  }
}

/** Ninety-six cubes exist per colour set; cards are never invented. */
export function invariants(state: RemedyState): string | void {
  for (const zone of ZONES) {
    let onBoard = 0;
    for (const city of CITIES) onBoard += cubesOn(state, city.id, zone);
    const total = onBoard + state.supply[zone];
    if (total !== CUBES_PER_ZONE) return `${zone} cube count is ${total}, should be ${CUBES_PER_ZONE}`;
    if (state.supply[zone] < 0) return `${zone} supply went negative`;
    for (const city of CITIES) {
      if (cubesOn(state, city.id, zone) > 3) return `${cityById(city.id).name} holds four ${zone} cubes`;
    }
  }
  const cards =
    Object.values(state.hands).flat().length +
    state.playerDeck.filter((c) => c !== "epidemic").length +
    state.playerDiscard.length;
  if (cards !== CITIES.length) return `player card count is ${cards}, should be ${CITIES.length}`;
  const infection = state.infectionDeck.length + state.infectionDiscard.length;
  if (infection !== CITIES.length) return `infection card count is ${infection}`;
  if (state.labs.length > MAX_LABS) return "too many laboratories";
  if (state.outbreaks > OUTBREAK_LIMIT) return "the outbreak track overflowed";
  return undefined;
}
