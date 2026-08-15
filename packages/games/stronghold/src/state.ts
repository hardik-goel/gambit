/**
 * Stronghold — hold the map or lose it.
 *
 * Three phases a turn: reinforce, attack as much as you dare, then one
 * fortifying move. Conquering opens an interrupt — how many armies march in —
 * because that decision can only be made once the dice have spoken.
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
  REGIONS,
  STARTING_ARMIES,
  TERRITORIES,
  TERRITORY_KEYS,
  byKey,
  connectedOwned,
  isSet,
  makeCardDeck,
  resolveDice,
  setValue,
  territoriesIn,
  type TerritoryCard
} from "./world";

export const configSchema = z.object({
  /** Conquest runs until one player is left; objectives keeps it under an hour. */
  mode: z.enum(["conquest", "objectives"]).default("objectives")
});

export type StrongholdConfig = z.infer<typeof configSchema>;

export type Phase = "setup" | "reinforce" | "attack" | "fortify";

export type StrongholdMove =
  | { kind: "place"; territory: string; count?: number }
  | { kind: "trade"; cards: number[] }
  | { kind: "attack"; from: string; to: string }
  | { kind: "occupy"; count: number }
  | { kind: "end-attack" }
  | { kind: "fortify"; from: string; to: string; count: number }
  | { kind: "end-turn" };

export type Objective =
  | { kind: "regions"; regions: string[] }
  | { kind: "territories"; count: number }
  | { kind: "any-regions"; count: number }
  | { kind: "eliminate"; seat: SeatId; fallback: number };

export interface StrongholdState extends BaseState {
  owner: Record<string, SeatId | null>;
  armies: Record<string, number>;
  hands: Record<SeatId, number[]>;
  deck: number[];
  discard: number[];
  cardsById: Record<number, TerritoryCard>;
  setsTraded: number;
  toPlace: Record<SeatId, number>;
  eliminated: SeatId[];
  objectives: Record<SeatId, Objective | null>;
  names: Record<SeatId, string>;
  turn: SeatId;
  phase: Phase;
  /** Conquest this turn earns a card at the end of it. */
  conquered: boolean;
  /** Turns since anything changed hands — see the sundown rule. */
  quietTurns: number;
  /** Set while an occupation is waiting to be sized. */
  occupation: { from: string; to: string; minimum: number; maximum: number } | null;
  /** Neutral armies are a two-player thing; they never take a turn. */
  neutral: boolean;
  mode: "conquest" | "objectives";
  winner: SeatId | null;
  finished: boolean;
}

const NEUTRAL: SeatId = -1;

export function createState(config: StrongholdConfig, seats: Seat[], seed: string): StrongholdState {
  const rng = new Rng(seed);
  const deck = makeCardDeck();
  const cardsById: Record<number, TerritoryCard> = {};
  for (const card of deck) cardsById[card.id] = card;

  const owner: Record<string, SeatId | null> = {};
  const armies: Record<string, number> = {};
  const shuffled = rng.shuffle(TERRITORY_KEYS);
  const players = seats.map((s) => s.id);
  // Two players share the map with a neutral force, so nobody starts with half
  // the world; at three or more the territories simply go round.
  const takers = seats.length === 2 ? [...players, NEUTRAL] : players;
  shuffled.forEach((key, i) => {
    owner[key] = takers[i % takers.length]!;
    armies[key] = 1;
  });

  const start = STARTING_ARMIES[seats.length] ?? 30;
  const toPlace: Record<SeatId, number> = {};
  for (const s of seats) {
    toPlace[s.id] = start - shuffled.filter((k) => owner[k] === s.id).length;
  }
  if (seats.length === 2) {
    toPlace[NEUTRAL] = 40 - shuffled.filter((k) => owner[k] === NEUTRAL).length;
  }

  const objectives: Record<SeatId, Objective | null> = {};
  if (config.mode === "objectives") {
    for (const s of seats) objectives[s.id] = rollObjective(rng, s.id, seats.length);
  } else {
    for (const s of seats) objectives[s.id] = null;
  }

  const names: Record<SeatId, string> = {};
  for (const s of seats) names[s.id] = s.name;

  return {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    owner,
    armies,
    hands: Object.fromEntries(seats.map((s) => [s.id, [] as number[]])),
    deck: rng.shuffle(deck.map((c) => c.id)),
    discard: [],
    cardsById,
    setsTraded: 0,
    toPlace,
    eliminated: [],
    objectives,
    names,
    turn: seats[0]!.id,
    phase: "setup",
    conquered: false,
    quietTurns: 0,
    occupation: null,
    neutral: seats.length === 2,
    mode: config.mode,
    winner: null,
    finished: false
  };
}

function rollObjective(rng: Rng, seat: SeatId, seatCount: number): Objective {
  const roll = rng.int(4);
  if (roll === 0) {
    const pair = rng.shuffle(REGIONS.map((r) => r.key)).slice(0, 2);
    return { kind: "regions", regions: pair };
  }
  if (roll === 1) return { kind: "territories", count: 24 };
  if (roll === 2) return { kind: "any-regions", count: 3 };
  const target = (seat + 1 + rng.int(Math.max(1, seatCount - 1))) % seatCount;
  // Being told to eliminate yourself is no objective at all, so it falls back.
  return { kind: "eliminate", seat: target === seat ? (seat + 1) % seatCount : target, fallback: 24 };
}

export const owned = (state: StrongholdState, seat: SeatId): string[] =>
  TERRITORY_KEYS.filter((k) => state.owner[k] === seat);

export function reinforcementsFor(state: StrongholdState, seat: SeatId): number {
  const mine = owned(state, seat);
  let armies = Math.max(3, Math.floor(mine.length / 3));
  for (const region of REGIONS) {
    if (territoriesIn(region.key).every((k) => state.owner[k] === seat)) armies += region.bonus;
  }
  return armies;
}

export function currentSeats(state: StrongholdState): SeatId[] {
  if (state.finished) return [];
  if (state.pending.length) return [state.pending.at(-1)!.seat];
  return [state.turn];
}

/* ------------------------------------------------------------ legal moves */

export function legalMoves(state: StrongholdState, seat: SeatId): StrongholdMove[] {
  if (state.finished || state.eliminated.includes(seat)) return [];

  const open = state.pending.at(-1);
  if (open) {
    if (open.seat !== seat) return [];
    if (open.kind === "occupy" && state.occupation) {
      const { minimum, maximum } = state.occupation;
      const options: StrongholdMove[] = [];
      for (let count = minimum; count <= maximum; count++) options.push({ kind: "occupy", count });
      return options;
    }
    return [];
  }

  if (state.turn !== seat) return [];
  const mine = owned(state, seat);
  const moves: StrongholdMove[] = [];

  if (state.phase === "setup") {
    if ((state.toPlace[seat] ?? 0) > 0) {
      for (const key of mine) moves.push({ kind: "place", territory: key });
    }
    return moves;
  }

  if (state.phase === "reinforce") {
    // Six cards in hand and you must trade before anything else.
    const hand = state.hands[seat] ?? [];
    const sets = tradeableSets(state, seat);
    if (hand.length >= 5) return sets;
    moves.push(...sets);
    if ((state.toPlace[seat] ?? 0) > 0) {
      for (const key of mine) moves.push({ kind: "place", territory: key });
      return moves;
    }
  }

  if (state.phase === "attack" || (state.phase === "reinforce" && (state.toPlace[seat] ?? 0) === 0)) {
    for (const from of mine) {
      if ((state.armies[from] ?? 0) < 2) continue;
      for (const to of byKey(from).borders) {
        if (state.owner[to] === seat) continue;
        moves.push({ kind: "attack", from, to });
      }
    }
    moves.push({ kind: "end-attack" });
  }

  if (state.phase === "fortify") {
    for (const from of mine) {
      const available = (state.armies[from] ?? 0) - 1;
      if (available < 1) continue;
      const reachable = connectedOwned((k) => state.owner[k] ?? null, seat, from);
      for (const to of reachable) {
        if (to === from) continue;
        // Offer the meaningful sizes rather than every integer.
        const sizes = new Set([1, Math.ceil(available / 2), available]);
        for (const count of sizes) if (count >= 1 && count <= available) moves.push({ kind: "fortify", from, to, count });
      }
    }
    moves.push({ kind: "end-turn" });
  }

  return moves;
}

function tradeableSets(state: StrongholdState, seat: SeatId): StrongholdMove[] {
  const hand = (state.hands[seat] ?? []).map((id) => state.cardsById[id]!);
  const out: StrongholdMove[] = [];
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        const trio = [hand[i]!, hand[j]!, hand[k]!];
        if (isSet(trio)) out.push({ kind: "trade", cards: trio.map((c) => c.id) });
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------- applying */

export function applyMove(
  state: StrongholdState,
  seat: SeatId,
  move: StrongholdMove
): Result<{ state: StrongholdState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  const kind = (move as { kind?: string })?.kind;
  const open = state.pending.at(-1);

  if (open) {
    if (open.seat !== seat) return err("not-your-turn", "Someone else is deciding right now.");
    if (kind !== "occupy") return err("must-occupy", "Say how many armies march in first.");
  } else if (state.turn !== seat) {
    return err("not-your-turn", "Wait for your turn.");
  }

  const next = clone(state);
  const events: GameEvent[] = [];

  switch (kind) {
    case "place": {
      const { territory } = move as { territory: string };
      if (next.owner[territory] !== seat) return err("not-yours", "That isn't your territory.");
      if ((next.toPlace[seat] ?? 0) <= 0) return err("none-left", "You have no armies left to place.");
      next.armies[territory] = (next.armies[territory] ?? 0) + 1;
      next.toPlace[seat]!--;
      next.ply++;
      events.push({
        type: "place",
        seat,
        text: `${next.names[seat]} reinforces ${byKey(territory).name}.`,
        data: { territory },
        sfx: "cubePlace"
      });

      if (next.phase === "setup") {
        advanceSetup(next, events);
      } else if ((next.toPlace[seat] ?? 0) === 0) {
        next.phase = "attack";
      }
      return ok({ state: next, events });
    }

    case "trade": {
      const { cards } = move as { cards: number[] };
      const hand = next.hands[seat] ?? [];
      if (!Array.isArray(cards) || cards.length !== 3) return err("bad-set", "A set is three cards.");
      if (!cards.every((id) => hand.includes(id))) return err("not-held", "You don't hold those cards.");
      if (!isSet(cards.map((id) => next.cardsById[id]!))) {
        return err("not-a-set", "Three alike, or one of each.");
      }
      const value = setValue(next.setsTraded);
      next.setsTraded++;
      next.hands[seat] = hand.filter((id) => !cards.includes(id));
      next.discard.push(...cards);
      next.toPlace[seat] = (next.toPlace[seat] ?? 0) + value;

      // A card matching a territory you hold is worth two extra armies there.
      for (const id of cards) {
        const card = next.cardsById[id]!;
        if (card.territory && next.owner[card.territory] === seat) {
          next.armies[card.territory] = (next.armies[card.territory] ?? 0) + 2;
          events.push({
            type: "bonus",
            seat,
            text: `Two extra armies muster at ${byKey(card.territory).name}.`,
            data: { territory: card.territory }
          });
          break;
        }
      }

      next.ply++;
      events.push({
        type: "trade",
        seat,
        text: `${next.names[seat]} trades a set for ${value} armies.`,
        sfx: "gemClink"
      });
      return ok({ state: next, events });
    }

    case "attack": {
      if (next.phase === "reinforce" && (next.toPlace[seat] ?? 0) > 0) {
        return err("place-first", "Place your reinforcements first.");
      }
      next.phase = "attack";
      const { from, to } = move as { from: string; to: string };
      if (next.owner[from] !== seat) return err("not-yours", "You don't hold that territory.");
      if (next.owner[to] === seat) return err("own-territory", "That's your own territory.");
      if (!byKey(from).borders.includes(to)) return err("not-adjacent", "Those territories don't share a border.");
      if ((next.armies[from] ?? 0) < 2) return err("too-few", "You need at least two armies to attack.");

      const rng = Rng.from(next.rng);
      const attackDice = Math.min(3, (next.armies[from] ?? 0) - 1);
      const defendDice = Math.min(2, next.armies[to] ?? 0);
      const attack = rng.dice(attackDice);
      const defence = rng.dice(defendDice);
      next.rng = rng.serialize();

      const losses = resolveDice(attack, defence);
      next.armies[from] = (next.armies[from] ?? 0) - losses.attacker;
      next.armies[to] = (next.armies[to] ?? 0) - losses.defender;
      next.ply++;

      events.push({
        type: "battle",
        seat,
        text: `${next.names[seat]} attacks ${byKey(to).name}: ${attack.join("/")} against ${defence.join("/")}.`,
        data: { from, to, attack, defence, losses },
        sfx: "diceTumble"
      });

      if ((next.armies[to] ?? 0) <= 0) {
        const loser = next.owner[to];
        next.owner[to] = seat;
        next.armies[to] = 0;
        next.conquered = true;
        next.occupation = {
          from,
          to,
          minimum: Math.min(attackDice, (next.armies[from] ?? 1) - 1),
          maximum: Math.max(1, (next.armies[from] ?? 1) - 1)
        };
        next.pending.push({
          id: pendingId(next, "occupy", seat),
          seat,
          kind: "occupy",
          prompt: `How many armies march into ${byKey(to).name}?`
        });
        events.push({
          type: "conquest",
          seat,
          text: `${byKey(to).name} falls to ${next.names[seat]}.`,
          data: { territory: to },
          sfx: "claim"
        });

        if (loser !== null && loser !== undefined && loser !== NEUTRAL) {
          checkElimination(next, loser, seat, events);
        }
      }
      return ok({ state: next, events });
    }

    case "occupy": {
      const { count } = move as { count: number };
      const occupation = next.occupation;
      if (!occupation) return err("nothing-to-occupy", "There's nothing to move into.");
      if (count < occupation.minimum || count > occupation.maximum) {
        return err("bad-count", `Move between ${occupation.minimum} and ${occupation.maximum} armies in.`);
      }
      next.armies[occupation.from] = (next.armies[occupation.from] ?? 0) - count;
      next.armies[occupation.to] = (next.armies[occupation.to] ?? 0) + count;
      next.occupation = null;
      next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.ply++;
      events.push({
        type: "occupy",
        seat,
        text: `${count} armies march into ${byKey(occupation.to).name}.`,
        sfx: "cubePlace"
      });
      checkVictory(next, events);
      return ok({ state: next, events });
    }

    case "end-attack": {
      next.phase = "fortify";
      next.ply++;
      return ok({ state: next, events });
    }

    case "fortify": {
      if (next.phase !== "fortify") return err("wrong-phase", "Finish attacking first.");
      const { from, to, count } = move as { from: string; to: string; count: number };
      if (next.owner[from] !== seat || next.owner[to] !== seat) {
        return err("not-yours", "Both ends must be yours.");
      }
      if (count < 1 || count > (next.armies[from] ?? 0) - 1) {
        return err("bad-count", "You must leave at least one army behind.");
      }
      if (!connectedOwned((k) => next.owner[k] ?? null, seat, from).has(to)) {
        return err("not-connected", "There's no line of your own territories between those two.");
      }
      next.armies[from] = (next.armies[from] ?? 0) - count;
      next.armies[to] = (next.armies[to] ?? 0) + count;
      next.ply++;
      events.push({
        type: "fortify",
        seat,
        text: `${count} armies march from ${byKey(from).name} to ${byKey(to).name}.`,
        sfx: "cubePlace"
      });
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    case "end-turn": {
      if (next.phase !== "fortify") return err("wrong-phase", "Finish attacking first.");
      next.ply++;
      endTurn(next, seat, events);
      return ok({ state: next, events });
    }

    default:
      return err("unknown-move", "That isn't a move this game understands.");
  }
}

function advanceSetup(state: StrongholdState, events: GameEvent[]): void {
  // Neutral armies drop in alongside the players, one at a time.
  if (state.neutral && (state.toPlace[NEUTRAL] ?? 0) > 0) {
    const rng = Rng.from(state.rng);
    const theirs = owned(state, NEUTRAL);
    if (theirs.length) {
      const spot = rng.pick(theirs);
      state.armies[spot] = (state.armies[spot] ?? 0) + 1;
      state.toPlace[NEUTRAL]!--;
    }
    state.rng = rng.serialize();
  }

  const remaining = Object.entries(state.toPlace)
    .filter(([seat]) => Number(seat) !== NEUTRAL)
    .some(([, n]) => n > 0);

  if (!remaining) {
    state.phase = "reinforce";
    state.turn = 0;
    state.toPlace[0] = reinforcementsFor(state, 0);
    events.push({ type: "setup-done", text: "Every army is placed. The first turn begins.", sfx: "start" });
    return;
  }

  // Next player with armies still to place.
  let seat = state.turn;
  for (let i = 0; i < state.seatCount; i++) {
    seat = (seat + 1) % state.seatCount;
    if ((state.toPlace[seat] ?? 0) > 0 && !state.eliminated.includes(seat)) break;
  }
  state.turn = seat;
}

function checkElimination(state: StrongholdState, loser: SeatId, victor: SeatId, events: GameEvent[]): void {
  if (owned(state, loser).length > 0) return;
  state.eliminated.push(loser);
  // Their cards change hands with their armies.
  const taken = state.hands[loser] ?? [];
  state.hands[victor] = [...(state.hands[victor] ?? []), ...taken];
  state.hands[loser] = [];
  events.push({
    type: "eliminated",
    seat: victor,
    text: `${state.names[loser]} is off the map${taken.length ? `, and their cards change hands` : ""}.`,
    sfx: "lose"
  });
}

function endTurn(state: StrongholdState, seat: SeatId, events: GameEvent[]): void {
  // A turn with a conquest in it earns exactly one card.
  if (state.conquered) {
    if (state.deck.length === 0 && state.discard.length) {
      const rng = Rng.from(state.rng);
      state.deck = rng.shuffle(state.discard);
      state.discard = [];
      state.rng = rng.serialize();
    }
    const card = state.deck.shift();
    if (card !== undefined) {
      state.hands[seat] = [...(state.hands[seat] ?? []), card];
      events.push({ type: "card", seat, text: `${state.names[seat]} takes a card.`, visibleTo: [seat], sfx: "cardSlip" });
    }
  }
  state.quietTurns = state.conquered ? 0 : state.quietTurns + 1;
  state.conquered = false;

  checkVictory(state, events);
  if (state.finished) return;

  // Sundown: a map where nothing has changed hands for a dozen turns each is a
  // map nobody is going to take. Rather than let a table grind forever, the
  // player holding the most ground wins it. Real games almost never reach this;
  // it exists so that no online table can hang.
  const quietLimit = state.seatCount * 12;
  if (state.quietTurns >= quietLimit) {
    const alive = Array.from({ length: state.seatCount }, (_, i) => i).filter(
      (x) => !state.eliminated.includes(x)
    );
    const ranked = alive
      .map((x) => ({
        seat: x,
        land: owned(state, x).length,
        armies: owned(state, x).reduce((n, k) => n + (state.armies[k] ?? 0), 0)
      }))
      .sort((a, b) => b.land - a.land || b.armies - a.armies);
    state.finished = true;
    state.winner = ranked[0]?.seat ?? null;
    events.push({
      type: "sundown",
      text: "The front has not moved in a dozen turns — the widest holding takes it.",
      sfx: "score"
    });
    return;
  }

  let nextSeat = seat;
  for (let i = 0; i < state.seatCount; i++) {
    nextSeat = (nextSeat + 1) % state.seatCount;
    if (!state.eliminated.includes(nextSeat)) break;
  }
  state.turn = nextSeat;
  state.phase = "reinforce";
  state.toPlace[nextSeat] = reinforcementsFor(state, nextSeat);
}

export function objectiveMet(state: StrongholdState, seat: SeatId): boolean {
  const objective = state.objectives[seat];
  if (!objective) return false;
  const mine = owned(state, seat);
  const holds = (region: string) => territoriesIn(region).every((k) => state.owner[k] === seat);

  switch (objective.kind) {
    case "regions":
      return objective.regions.every(holds);
    case "territories":
      return mine.length >= objective.count;
    case "any-regions":
      return REGIONS.filter((r) => holds(r.key)).length >= objective.count;
    case "eliminate": {
      // If the target is gone by someone else's hand — or was never in the
      // game — the objective falls back to holding a lot of ground.
      const target = objective.seat;
      if (target === seat || target >= state.seatCount) return mine.length >= objective.fallback;
      if (state.eliminated.includes(target)) return true;
      return mine.length >= objective.fallback;
    }
    default:
      return false;
  }
}

function checkVictory(state: StrongholdState, events: GameEvent[]): void {
  const alive = Array.from({ length: state.seatCount }, (_, i) => i).filter(
    (s) => !state.eliminated.includes(s)
  );
  if (alive.length === 1) {
    state.finished = true;
    state.winner = alive[0]!;
    events.push({ type: "victory", seat: state.winner, text: `${state.names[state.winner]} holds the map.`, sfx: "win" });
    return;
  }
  if (state.mode === "objectives") {
    for (const seat of alive) {
      if (objectiveMet(state, seat)) {
        state.finished = true;
        state.winner = seat;
        events.push({
          type: "victory",
          seat,
          text: `${state.names[seat]} completes their objective.`,
          sfx: "win"
        });
        return;
      }
    }
  }
}

export function isTerminal(state: StrongholdState): boolean {
  return state.finished;
}

export function score(state: StrongholdState): FinalScore[] {
  const entries = Array.from({ length: state.seatCount }, (_, seat) => {
    const mine = owned(state, seat);
    const armies = mine.reduce((n, k) => n + (state.armies[k] ?? 0), 0);
    const regions = REGIONS.filter((r) => territoriesIn(r.key).every((k) => state.owner[k] === seat));
    return {
      seat,
      total: seat === state.winner ? 1000 : mine.length * 10 + armies,
      lines: [
        { label: "Territories", value: mine.length },
        { label: "Armies", value: armies },
        { label: "Regions held", value: regions.length }
      ]
    };
  });
  const ranked = rankScores(entries);
  if (state.winner !== null) for (const r of ranked) r.won = r.seat === state.winner;
  return ranked;
}

/* -------------------------------------------------------------- redaction */

export interface StrongholdView {
  owner: Record<string, SeatId | null>;
  armies: Record<string, number>;
  /** Your own cards. Everyone else's is a count. */
  hand: { id: number; territory: string | null; symbol: string }[];
  handCounts: Record<SeatId, number>;
  toPlace: Record<SeatId, number>;
  setsTraded: number;
  nextSetValue: number;
  eliminated: SeatId[];
  /** Your own objective only — that is the entire point of it. */
  objective: Objective | null;
  names: Record<SeatId, string>;
  turn: SeatId;
  phase: Phase;
  conquered: boolean;
  occupation: { from: string; to: string; minimum: number; maximum: number } | null;
  mode: string;
  deckCount: number;
  winner: SeatId | null;
  finished: boolean;
  seat: SeatId | "spectator";
  pending: { kind: string; prompt?: string } | null;
}

export function redactStateFor(state: StrongholdState, viewer: SeatId | "spectator"): StrongholdView {
  const handCounts: Record<SeatId, number> = {};
  for (const [seat, hand] of Object.entries(state.hands)) handCounts[Number(seat)] = hand.length;
  const open = state.pending.at(-1);

  return {
    owner: { ...state.owner },
    armies: { ...state.armies },
    hand:
      viewer === "spectator"
        ? []
        : (state.hands[viewer] ?? []).map((id) => ({ ...state.cardsById[id]! })),
    handCounts,
    toPlace: { ...state.toPlace },
    setsTraded: state.setsTraded,
    nextSetValue: setValue(state.setsTraded),
    eliminated: state.eliminated.slice(),
    objective: viewer === "spectator" ? null : (state.objectives[viewer] ?? null),
    names: { ...state.names },
    turn: state.turn,
    phase: state.phase,
    conquered: state.conquered,
    occupation: state.occupation ? { ...state.occupation } : null,
    mode: state.mode,
    deckCount: state.deck.length,
    winner: state.winner,
    finished: state.finished,
    seat: viewer,
    pending: open && open.seat === viewer ? { kind: open.kind, prompt: open.prompt } : null
  };
}

export function describeMove(_state: StrongholdState, _seat: SeatId, move: StrongholdMove): string {
  switch (move.kind) {
    case "place": return `reinforces ${byKey(move.territory).name}`;
    case "trade": return "trades a set";
    case "attack": return `attacks ${byKey(move.to).name}`;
    case "occupy": return `moves ${move.count} in`;
    case "fortify": return `fortifies ${byKey(move.to).name}`;
    case "end-attack": return "stops attacking";
    default: return "ends the turn";
  }
}

/** Armies are never negative; every territory has an owner and a garrison. */
export function invariants(state: StrongholdState): string | void {
  for (const key of TERRITORY_KEYS) {
    const armies = state.armies[key] ?? 0;
    if (armies < 0) return `${key} has ${armies} armies`;
    if (state.owner[key] === undefined) return `${key} has no owner`;
    // A territory can only be empty while its occupation is still pending.
    if (armies === 0 && !state.occupation) return `${key} is held by nobody's army`;
  }
  for (const seat of state.eliminated) {
    if (owned(state, seat).length > 0) return `an eliminated player still holds ground`;
  }
  const cards = Object.values(state.hands).flat().length + state.deck.length + state.discard.length;
  if (cards !== 44) return `card count is ${cards}, should be 44`;
  return undefined;
}

export { TERRITORIES, REGIONS };
