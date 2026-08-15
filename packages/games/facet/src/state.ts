/**
 * Facet — collect gems, chain discounts, court the patrons, reach fifteen.
 *
 * The interesting parts of the implementation are the two interrupts: going
 * over the ten-token cap makes you hand tokens back before your turn can end,
 * and qualifying for two patrons at once makes you choose. Both run on the
 * platform's pending-input stack rather than on anything game-specific.
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
import { GOLD, NOBLES, deckFor, tokensPerGem, type DevCard, type Gem, type Noble } from "./cards";

export const configSchema = z.object({
  /** Prestige needed to trigger the final round. */
  target: z.enum(["15", "20"]).default("15")
});

export type FacetConfig = z.infer<typeof configSchema>;

export type FacetMove =
  | { kind: "take3"; gems: Gem[] }
  | { kind: "take2"; gem: Gem }
  | { kind: "reserve"; tier: 1 | 2 | 3; index: number }
  | { kind: "buy"; source: "board" | "reserve"; tier?: 1 | 2 | 3; index: number }
  | { kind: "return"; gem: number }
  | { kind: "noble"; index: number }
  | { kind: "pass" };

export interface PlayerState {
  /** Tokens held, indexed by gem; index 5 is gold. */
  tokens: number[];
  /** Cards bought, which are also permanent discounts. */
  bought: DevCard[];
  reserved: DevCard[];
  nobles: Noble[];
  prestige: number;
}

export interface FacetState extends BaseState {
  decks: Record<1 | 2 | 3, DevCard[]>;
  rows: Record<1 | 2 | 3, (DevCard | null)[]>;
  bank: number[];
  nobles: Noble[];
  players: Record<SeatId, PlayerState>;
  names: Record<SeatId, string>;
  turn: SeatId;
  target: number;
  /** One patron visit per turn, no matter how many qualify. */
  nobleThisTurn: boolean;
  /** Set once someone passes the target: the round is played out to the end. */
  finishing: boolean;
  finished: boolean;
}

export const discountsOf = (p: PlayerState): number[] => {
  const d = [0, 0, 0, 0, 0];
  for (const c of p.bought) d[c.gem]!++;
  return d;
};

export const tokenCount = (p: PlayerState): number => p.tokens.reduce((a, b) => a + b, 0);

export function createState(config: FacetConfig, seats: Seat[], seed: string): FacetState {
  const rng = new Rng(seed);
  const decks = {
    1: rng.shuffle(deckFor(1)),
    2: rng.shuffle(deckFor(2)),
    3: rng.shuffle(deckFor(3))
  } as Record<1 | 2 | 3, DevCard[]>;

  const rows = { 1: [], 2: [], 3: [] } as Record<1 | 2 | 3, (DevCard | null)[]>;
  for (const tier of [1, 2, 3] as const) {
    rows[tier] = Array.from({ length: 4 }, () => decks[tier].shift() ?? null);
  }

  const players: Record<SeatId, PlayerState> = {};
  const names: Record<SeatId, string> = {};
  for (const s of seats) {
    players[s.id] = { tokens: [0, 0, 0, 0, 0, 0], bought: [], reserved: [], nobles: [], prestige: 0 };
    names[s.id] = s.name;
  }

  const per = tokensPerGem(seats.length);
  return {
    rng: rng.serialize(),
    seatCount: seats.length,
    ply: 0,
    pending: [],
    decks,
    rows,
    bank: [per, per, per, per, per, 5],
    nobles: rng.shuffle(NOBLES).slice(0, seats.length + 1),
    players,
    names,
    turn: seats[0]!.id,
    target: Number(config.target),
    nobleThisTurn: false,
    finishing: false,
    finished: false
  };
}

export function currentSeats(state: FacetState): SeatId[] {
  if (state.finished) return [];
  // An interrupt owns the table while it is open.
  if (state.pending.length) return [state.pending.at(-1)!.seat];
  return [state.turn];
}

/** What a card actually costs this player, after discounts, and how much gold. */
export function payment(player: PlayerState, card: DevCard): { pay: number[]; gold: number } | null {
  const discounts = discountsOf(player);
  const pay = [0, 0, 0, 0, 0];
  let gold = 0;
  for (let g = 0; g < 5; g++) {
    const need = Math.max(0, card.cost[g]! - discounts[g]!);
    const have = player.tokens[g]!;
    pay[g] = Math.min(need, have);
    gold += Math.max(0, need - have);
  }
  if (gold > player.tokens[GOLD]!) return null;
  return { pay, gold };
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combinations(items.slice(i + 1), size - 1)) out.push([item, ...rest]);
  });
  return out;
}

export function legalMoves(state: FacetState, seat: SeatId): FacetMove[] {
  if (state.finished) return [];

  const open = state.pending.at(-1);
  if (open) {
    if (open.seat !== seat) return [];
    if (open.kind === "return-tokens") {
      const player = state.players[seat]!;
      return player.tokens
        .map((n, gem) => ({ n, gem }))
        .filter((t) => t.n > 0)
        .map((t) => ({ kind: "return" as const, gem: t.gem }));
    }
    if (open.kind === "choose-noble") {
      const options = (open.data?.options as number[]) ?? [];
      return options.map((index) => ({ kind: "noble" as const, index }));
    }
    return [];
  }

  if (state.turn !== seat) return [];
  const player = state.players[seat]!;
  const moves: FacetMove[] = [];

  const available = ([0, 1, 2, 3, 4] as Gem[]).filter((g) => state.bank[g]! > 0);
  const takeSize = Math.min(3, available.length);
  if (takeSize > 0) {
    for (const gems of combinations(available, takeSize)) moves.push({ kind: "take3", gems });
  }
  for (const gem of [0, 1, 2, 3, 4] as Gem[]) {
    if (state.bank[gem]! >= 4) moves.push({ kind: "take2", gem });
  }

  if (player.reserved.length < 3) {
    for (const tier of [1, 2, 3] as const) {
      state.rows[tier].forEach((card, index) => {
        if (card) moves.push({ kind: "reserve", tier, index });
      });
      // Reserving blind off the top of a deck is a legitimate, and rude, move.
      if (state.decks[tier].length > 0) moves.push({ kind: "reserve", tier, index: -1 });
    }
  }

  for (const tier of [1, 2, 3] as const) {
    state.rows[tier].forEach((card, index) => {
      if (card && payment(player, card)) moves.push({ kind: "buy", source: "board", tier, index });
    });
  }
  player.reserved.forEach((card, index) => {
    if (payment(player, card)) moves.push({ kind: "buy", source: "reserve", index });
  });

  // A player with an empty bank, no affordable card and three cards reserved
  // has genuinely nothing to do; passing keeps the round moving.
  if (moves.length === 0) moves.push({ kind: "pass" });
  return moves;
}

export function applyMove(
  state: FacetState,
  seat: SeatId,
  move: FacetMove
): Result<{ state: FacetState; events: GameEvent[] }> {
  if (state.finished) return err("finished", "This game is already over.");
  const kind = (move as { kind?: string })?.kind;
  const open = state.pending.at(-1);

  if (open) {
    if (open.seat !== seat) return err("not-your-turn", "Someone else is deciding right now.");
    if (open.kind === "return-tokens" && kind !== "return") {
      return err("must-return", "Hand back tokens until you're down to ten.");
    }
    if (open.kind === "choose-noble" && kind !== "noble") {
      return err("must-choose", "Choose which patron visits you.");
    }
  } else if (state.turn !== seat) {
    return err("not-your-turn", "Wait for your turn.");
  }

  const next = clone(state);
  const player = next.players[seat]!;
  const events: GameEvent[] = [];

  switch (kind) {
    case "return": {
      const { gem } = move as { gem: number };
      if (!player.tokens[gem]) return err("no-token", "You don't hold that token.");
      player.tokens[gem]!--;
      next.bank[gem]!++;
      next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.ply++;
      events.push({ type: "return", seat, text: `${next.names[seat]} returns a token.`, sfx: "gemClink" });
      return ok({ state: settle(next, seat, events), events });
    }

    case "noble": {
      const { index } = move as { index: number };
      const noble = next.nobles[index];
      if (!noble) return err("no-noble", "That patron isn't at the table.");
      if (!meetsRequirement(player, noble)) return err("not-qualified", "You don't have the cards for that patron.");
      next.nobles.splice(index, 1);
      player.nobles.push(noble);
      player.prestige += noble.prestige;
      next.nobleThisTurn = true;
      next.pending = next.pending.filter((p) => p.id !== open!.id);
      next.ply++;
      events.push({
        type: "noble",
        seat,
        text: `A patron visits ${next.names[seat]}.`,
        sfx: "claim"
      });
      return ok({ state: settle(next, seat, events), events });
    }

    case "take3": {
      const { gems } = move as { gems: Gem[] };
      if (!Array.isArray(gems) || gems.length === 0) return err("bad-take", "Pick some gems.");
      if (new Set(gems).size !== gems.length) return err("duplicate", "Three *different* gems.");
      const available = ([0, 1, 2, 3, 4] as Gem[]).filter((g) => next.bank[g]! > 0);
      if (gems.length > 3) return err("too-many", "Three gems at most.");
      if (gems.length < Math.min(3, available.length)) {
        return err("take-more", "Take three different gems while they're there.");
      }
      for (const g of gems) {
        if (next.bank[g]! <= 0) return err("empty-pile", "That pile is empty.");
      }
      for (const g of gems) {
        next.bank[g]!--;
        player.tokens[g]!++;
      }
      next.ply++;
      events.push({
        type: "take",
        seat,
        text: `${next.names[seat]} takes ${gems.length} gems.`,
        sfx: "gemClink"
      });
      return ok({ state: settle(next, seat, events), events });
    }

    case "take2": {
      const { gem } = move as { gem: Gem };
      if (next.bank[gem]! < 4) return err("too-thin", "You can only take two from a pile of four or more.");
      next.bank[gem]! -= 2;
      player.tokens[gem]! += 2;
      next.ply++;
      events.push({ type: "take", seat, text: `${next.names[seat]} takes two.`, sfx: "gemClink" });
      return ok({ state: settle(next, seat, events), events });
    }

    case "reserve": {
      const { tier, index } = move as { tier: 1 | 2 | 3; index: number };
      if (![1, 2, 3].includes(tier)) return err("bad-tier", "There's no such row.");
      if (player.reserved.length >= 3) return err("hand-full", "You already hold three reserved cards.");
      let card: DevCard | null = null;
      if (index === -1) {
        card = next.decks[tier].shift() ?? null;
        if (!card) return err("deck-empty", "That deck has run out.");
      } else {
        card = next.rows[tier][index] ?? null;
        if (!card) return err("no-card", "There's no card there.");
        next.rows[tier][index] = next.decks[tier].shift() ?? null;
      }
      player.reserved.push(card);
      if (next.bank[GOLD]! > 0) {
        next.bank[GOLD]!--;
        player.tokens[GOLD]!++;
      }
      next.ply++;
      events.push({
        type: "reserve",
        seat,
        text: `${next.names[seat]} reserves a card${index === -1 ? " off the top" : ""}.`,
        sfx: "cardSlip"
      });
      return ok({ state: settle(next, seat, events), events });
    }

    case "buy": {
      const { source, tier, index } = move as { source: "board" | "reserve"; tier?: 1 | 2 | 3; index: number };
      let card: DevCard | null = null;
      if (source === "reserve") {
        card = player.reserved[index] ?? null;
        if (!card) return err("no-card", "You haven't reserved a card there.");
      } else {
        if (!tier || ![1, 2, 3].includes(tier)) return err("bad-tier", "There's no such row.");
        card = next.rows[tier][index] ?? null;
        if (!card) return err("no-card", "There's no card there.");
      }
      const cost = payment(player, card);
      if (!cost) return err("too-dear", "You can't cover that card yet.");

      for (let g = 0; g < 5; g++) {
        player.tokens[g]! -= cost.pay[g]!;
        next.bank[g]! += cost.pay[g]!;
      }
      player.tokens[GOLD]! -= cost.gold;
      next.bank[GOLD]! += cost.gold;

      player.bought.push(card);
      player.prestige += card.prestige;
      if (source === "reserve") player.reserved.splice(index, 1);
      else next.rows[tier!][index] = next.decks[tier!].shift() ?? null;

      next.ply++;
      events.push({
        type: "buy",
        seat,
        text: `${next.names[seat]} buys a tier ${card.tier} card${
          card.prestige ? ` for ${card.prestige} prestige` : ""
        }.`,
        data: { card: card.id, prestige: card.prestige },
        sfx: card.prestige >= 3 ? "claim" : "gemClink"
      });
      return ok({ state: settle(next, seat, events), events });
    }

    case "pass": {
      if (legalMoves(state, seat).some((m) => m.kind !== "pass")) {
        return err("can-move", "You still have something you can do.");
      }
      next.ply++;
      events.push({ type: "pass", seat, text: `${next.names[seat]} can do nothing this turn.` });
      return ok({ state: settle(next, seat, events), events });
    }

    default:
      return err("unknown-move", "That isn't a move this game understands.");
  }
}

function meetsRequirement(player: PlayerState, noble: Noble): boolean {
  const d = discountsOf(player);
  return noble.requirement.every((need, gem) => d[gem]! >= need);
}

/**
 * Everything that happens after an action: the token cap, the patrons, and
 * finally passing the turn on. Any step may open an interrupt, in which case
 * the turn stays put until it is answered.
 */
function settle(state: FacetState, seat: SeatId, events: GameEvent[]): FacetState {
  const player = state.players[seat]!;

  if (tokenCount(player) > 10) {
    state.pending = [
      ...state.pending,
      {
        id: pendingId(state, "return-tokens", seat),
        seat,
        kind: "return-tokens",
        prompt: `You're holding ${tokenCount(player)} tokens. Hand back ${tokenCount(player) - 10}.`
      }
    ];
    return state;
  }

  // A patron visits at most once per turn, however many are impressed.
  const qualified = state.nobleThisTurn
    ? []
    : state.nobles
        .map((noble, index) => ({ noble, index }))
        .filter((n) => meetsRequirement(player, n.noble));

  if (qualified.length === 1) {
    const { noble, index } = qualified[0]!;
    state.nobles.splice(index, 1);
    player.nobles.push(noble);
    player.prestige += noble.prestige;
    state.nobleThisTurn = true;
    events.push({ type: "noble", seat, text: `A patron visits ${state.names[seat]}.`, sfx: "claim" });
  } else if (qualified.length > 1) {
    state.pending = [
      ...state.pending,
      {
        id: pendingId(state, "choose-noble", seat),
        seat,
        kind: "choose-noble",
        prompt: "Two patrons want to visit. Choose one.",
        data: { options: qualified.map((q) => q.index) }
      }
    ];
    return state;
  }

  if (player.prestige >= state.target) state.finishing = true;

  // Nothing left to buy anywhere is also an ending, even if nobody got there.
  const boardEmpty =
    ([1, 2, 3] as const).every((t) => state.rows[t].every((c) => c === null) && state.decks[t].length === 0);
  if (boardEmpty) {
    state.finished = true;
    events.push({ type: "game-end", text: "Every card has been bought.", sfx: "score" });
    return state;
  }

  const nextSeat = (seat + 1) % state.seatCount;
  // "Finish the round" means everyone gets the same number of turns, so the
  // game ends when play would return to the seat that started it.
  if (state.finishing && nextSeat === 0) {
    state.finished = true;
    events.push({ type: "game-end", text: "The final round is complete.", sfx: "win" });
    return state;
  }
  state.turn = nextSeat;
  state.nobleThisTurn = false;
  return state;
}

export function isTerminal(state: FacetState): boolean {
  return state.finished;
}

export function score(state: FacetState): FinalScore[] {
  const entries = Object.keys(state.players)
    .map(Number)
    .map((seat) => {
      const p = state.players[seat]!;
      const fromCards = p.bought.reduce((n, c) => n + c.prestige, 0);
      return {
        seat,
        total: p.prestige,
        lines: [
          { label: "Cards", value: fromCards },
          { label: "Patrons", value: p.nobles.length * 3 },
          { label: "Cards bought", value: 0 }
        ]
      };
    });
  // A tie goes to whoever got there with fewer cards.
  return rankScores(entries, (a, b) => state.players[a]!.bought.length - state.players[b]!.bought.length);
}

export interface FacetView {
  rows: Record<1 | 2 | 3, (DevCard | null)[]>;
  deckCounts: Record<1 | 2 | 3, number>;
  bank: number[];
  nobles: Noble[];
  players: Record<SeatId, Omit<PlayerState, "reserved"> & { reservedCount: number }>;
  /** Your own reserved cards; nobody else's are ever sent. */
  reserved: DevCard[];
  names: Record<SeatId, string>;
  turn: SeatId;
  target: number;
  finishing: boolean;
  finished: boolean;
  seat: SeatId | "spectator";
  pending: { kind: string; prompt?: string; options?: number[] } | null;
}

export function redactStateFor(state: FacetState, viewer: SeatId | "spectator"): FacetView {
  const players: FacetView["players"] = {};
  for (const [key, p] of Object.entries(state.players)) {
    players[Number(key)] = {
      tokens: p.tokens.slice(),
      bought: p.bought.map((c) => ({ ...c })),
      nobles: p.nobles.map((n) => ({ ...n })),
      prestige: p.prestige,
      reservedCount: p.reserved.length
    };
  }
  const open = state.pending.at(-1);
  return {
    rows: {
      1: state.rows[1].map((c) => (c ? { ...c } : null)),
      2: state.rows[2].map((c) => (c ? { ...c } : null)),
      3: state.rows[3].map((c) => (c ? { ...c } : null))
    },
    deckCounts: { 1: state.decks[1].length, 2: state.decks[2].length, 3: state.decks[3].length },
    bank: state.bank.slice(),
    nobles: state.nobles.map((n) => ({ ...n })),
    players,
    // A card reserved blind is yours alone to know about.
    reserved: viewer === "spectator" ? [] : (state.players[viewer]?.reserved.map((c) => ({ ...c })) ?? []),
    names: { ...state.names },
    turn: state.turn,
    target: state.target,
    finishing: state.finishing,
    finished: state.finished,
    seat: viewer,
    pending:
      open && open.seat === viewer
        ? { kind: open.kind, prompt: open.prompt, options: open.data?.options as number[] | undefined }
        : null
  };
}

export function describeMove(_state: FacetState, _seat: SeatId, move: FacetMove): string {
  switch (move.kind) {
    case "take3": return "takes gems";
    case "take2": return "takes a pair";
    case "reserve": return "reserves a card";
    case "buy": return "buys a card";
    case "return": return "returns a token";
    case "noble": return "receives a patron";
    default: return "passes";
  }
}

/** Tokens and cards are conserved, and prestige always matches what's owned. */
export function invariants(state: FacetState): string | void {
  const per = tokensPerGem(state.seatCount);
  for (let gem = 0; gem < 5; gem++) {
    let total = state.bank[gem]!;
    for (const p of Object.values(state.players)) total += p.tokens[gem]!;
    if (total !== per) return `gem ${gem} count is ${total}, should be ${per}`;
  }
  let gold = state.bank[GOLD]!;
  for (const p of Object.values(state.players)) gold += p.tokens[GOLD]!;
  if (gold !== 5) return `gold count is ${gold}, should be 5`;

  for (const p of Object.values(state.players)) {
    if (p.reserved.length > 3) return "a player holds more than three reserved cards";
    if (state.pending.length === 0 && tokenCount(p) > 10) return "a player is over the token cap";
    const expected = p.bought.reduce((n, c) => n + c.prestige, 0) + p.nobles.length * 3;
    if (p.prestige !== expected) return `prestige is ${p.prestige}, should be ${expected}`;
  }
  return undefined;
}
