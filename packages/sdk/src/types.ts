/**
 * The Gambit game contract.
 *
 * A game is a plugin: one package exporting one `GameDefinition`. The platform
 * knows nothing about any specific game — it only knows this interface. Adding
 * game #12 means adding a package and one registry line; zero platform changes.
 *
 * Two rules hold for every implementation:
 *   1. `applyMove` is pure and deterministic — same (state, seat, move) always
 *      yields the same result, on server and client alike (isomorphic TS).
 *      This is what makes optimistic local play and exact replays possible.
 *   2. `redactStateFor` is the ONLY path from server state to any client. If a
 *      value is not in the redacted view, no client can ever see it.
 */
import type { ComponentType } from "react";
import type { ZodTypeAny } from "zod";
import type { RngState } from "./rng";

/** Seat index within a room, 0-based. Stable for the life of a game. */
export type SeatId = number;

export type Complexity = 1 | 2 | 3 | 4 | 5;
export type BotLevel = 1 | 2 | 3;

/* ------------------------------------------------------------------ seats */

export interface Seat {
  id: SeatId;
  /** Profile id, or a bot id like "bot:2". */
  playerId: string;
  name: string;
  avatar?: string | null;
  isBot: boolean;
  botLevel?: BotLevel;
  /** Team key when the game defines teams; undefined for free-for-all. */
  team?: string;
  /** Asymmetric role assigned at setup (Phantom fugitive, Remedy role, …). */
  role?: string;
}

export interface TeamSpec {
  /** Allowed team layouts, e.g. ["2v2", "3v3"]. */
  modes: string[];
  /** Given a seat count, the team key for each seat index. */
  assign(seatCount: number, mode: string): string[];
}

/* ------------------------------------------------------------------ theme */

/** Per-game skin tokens, layered over the user's shell theme. */
export interface ThemeTokens {
  /** Signature hue for spines, covers, chips. */
  hue: string;
  /** Table surface for this game. */
  felt: string;
  /** Secondary accent (metal, ink, foil). */
  accent: string;
  /** Optional board-specific ramp for pieces/pawns/routes. */
  players?: string[];
}

/* ------------------------------------------------------------------ moves */

export interface MoveError {
  code: string;
  /** One line, player-facing: why this tap was illegal. Shown in a toast. */
  message: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: MoveError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(code: string, message: string): Result<T> => ({
  ok: false,
  error: { code, message }
});

/* ----------------------------------------------------------------- events */

/**
 * Events are the append-only truth of a game. The state snapshot is a cache;
 * the event log is the record. Replays, reconnects, audit and the move ticker
 * all read from here.
 */
export interface GameEvent {
  type: string;
  /** Seat that caused the event, if any. */
  seat?: SeatId;
  /** Human-readable one-liner for the ticker and screen-reader log. */
  text?: string;
  /** Structured payload for animation and replay. */
  data?: Record<string, unknown>;
  /**
   * Seats allowed to see this event's payload. Omitted = public.
   * The platform filters on this before broadcasting.
   */
  visibleTo?: SeatId[];
  /** Sound to trigger; resolved through the game's `audioCues`. */
  sfx?: string;
}

/* --------------------------------------------------------- pending inputs */

/**
 * Out-of-turn prompts: Landfall's discard-on-7, Motive's disprove, Remedy's
 * consent to be moved. Modelled as a stack so a prompt can itself spawn one.
 * While the stack is non-empty, `currentSeats` returns the prompted seats.
 */
export interface PendingInput {
  id: string;
  seat: SeatId;
  /** Game-specific discriminator, e.g. "discard-half" | "disprove". */
  kind: string;
  /** Prompt copy shown to that seat. */
  prompt?: string;
  /** Wall-clock deadline in ms; the platform auto-resolves via `bot` after. */
  deadlineMs?: number;
  data?: Record<string, unknown>;
}

/* ------------------------------------------------------------ final score */

export interface ScoreLine {
  label: string;
  value: number;
}

export interface FinalScore {
  seat: SeatId;
  total: number;
  /** Category-by-category breakdown, drives the count-up reveal. */
  lines: ScoreLine[];
  rank: number;
  won: boolean;
}

/* -------------------------------------------------------------- tutorials */

export interface TutorialStep {
  /** Short instruction shown in the coach bubble. */
  text: string;
  /** CSS selector or board element id to spotlight. */
  spotlight?: string;
  /** Move the tutorial performs on the learner's behalf when they tap. */
  demoMove?: unknown;
  /** Predicate name the board exposes to advance on a real player action. */
  await?: string;
}

export interface TutorialScript {
  /** Seats to create for the sandbox table (learner is seat 0). */
  seats: number;
  /** Fixed seed so the tutorial is identical for everyone. */
  seed: string;
  steps: TutorialStep[];
}

/* ------------------------------------------------------------ board props */

export interface BoardProps<V, M> {
  /** Redacted view for this viewer — never the full server state. */
  view: V;
  /** Legal moves for this viewer's seat, from the engine. Never client-guessed. */
  legal: M[];
  /** This viewer's seat, or null when spectating. */
  seat: SeatId | null;
  seats: Seat[];
  /** Submit a move. Applies locally first, then reconciles with the server. */
  play(move: M): void;
  /** True while the last local move awaits server acknowledgement. */
  pending: boolean;
  /** Recent events for choreography — newest last. */
  events: GameEvent[];
  /** Fire a named sound effect from this game's cue table. */
  sfx(cue: string): void;
  /** Honours prefers-reduced-motion; boards must respect it. */
  reducedMotion: boolean;
}

/* ------------------------------------------------------------ definition */

export interface GameMeta {
  name: string;
  tagline: string;
  /**
   * What kind of game this is, in the words somebody would use who had never
   * heard of it. The names are original, which means they carry no hint of
   * what is inside; a tagline sets the mood but does not say "this is a
   * deduction game". This does, in two or three plain words.
   *
   * Never a comparison to another product. Mechanics are not protectable and
   * ours are our own, but the names of the games these resemble belong to
   * their publishers — see LEGAL.md.
   */
  kind: string;
  /**
   * The well-known game this one will feel familiar to, named so that a player
   * recognises the shelf immediately rather than having to open every box.
   *
   * The title belongs to its publisher and is recorded with it, so that
   * anywhere this is shown can attribute it. Public-domain games name
   * themselves and have no publisher. See LEGAL.md and /compare.
   */
  familiar?: { title: string; publisher?: string };
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
  avgMinutes: number;
  complexity: Complexity;
  badges: string[];
  teams?: TeamSpec;
  asymmetric?: boolean;
  coop?: boolean;
  themeTokens: ThemeTokens;
}

/** Base fields every game state carries so the platform can reason generically. */
export interface BaseState {
  rng: RngState;
  /** Seats in the game, mirrored from the room at createState time. */
  seatCount: number;
  /** Monotonic count of applied moves. */
  ply: number;
  /** Out-of-turn prompt stack; empty in the common case. */
  pending: PendingInput[];
}

export interface GameDefinition<S extends BaseState, M, V> {
  id: string;
  version: string;
  meta: GameMeta;

  /** Host-facing options; the lobby panel is generated from this schema. */
  configSchema: ZodTypeAny;

  createState(config: unknown, seats: Seat[], seed: string): S;

  /**
   * Every legal move for a seat, right now. This one function powers the UI's
   * lit affordances, the illegal-tap explanations, and all three bot levels —
   * so a game can never disagree with itself about what is allowed.
   */
  legalMoves(state: S, seat: SeatId): M[];

  applyMove(state: S, seat: SeatId, move: M): Result<{ state: S; events: GameEvent[] }>;

  /** Seats that may act right now (turn holder, or the pending-input holders). */
  currentSeats(state: S): SeatId[];

  /** The hidden-information firewall. */
  redactStateFor(state: S, viewer: SeatId | "spectator"): V;

  isTerminal(state: S): boolean;
  score(state: S): FinalScore[];

  bot(view: V, legal: M[], rng: Rng, level: BotLevel): M;

  Board: ComponentType<BoardProps<V, M>>;
  Tutorial: TutorialScript;
  audioCues: Record<string, string>;

  /**
   * Optional invariants checked by the test kit after every move
   * (card conservation, cube counts, piece counts). Throw or return a string
   * to fail. Cheap to write, catches whole classes of rule bugs.
   */
  invariants?: (state: S) => string | void;

  /** Compact one-line description of a move, for the ticker and PGN-alikes. */
  describeMove?: (state: S, seat: SeatId, move: M) => string;

  /**
   * Optimistic prediction. The client holds only a redacted view, so it cannot
   * always run `applyMove` — but it can almost always show the visible
   * consequence of your own move immediately (piece slides, chip lands, card
   * leaves your hand) and let the server fill in what it couldn't know (the
   * face of a drawn card, the result of a die).
   *
   * Perfect-information games pass `applyMove` straight through: for Chess the
   * view IS the state. Hidden-information games apply the visible part and mark
   * unknowns as placeholders. Returning the view unchanged is always safe — the
   * move simply waits for the server, which is the old, slower feel.
   *
   * This is what makes input→pixel latency zero rather than one round trip.
   */
  predict?: (view: V, seat: SeatId, move: M) => V;
}

// Imported here rather than at the top to keep the type surface documented
// in the order a reader meets it.
import type { Rng } from "./rng";

/** Any game definition, for registries and platform code. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameDefinition = GameDefinition<any, any, any>;
