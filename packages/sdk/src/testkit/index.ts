/**
 * The test kit every Gambit game must pass in CI:
 *   1. `simulate`      — bot-vs-bot games that must terminate cleanly.
 *   2. `checkInvariants` — state conservation checks after every single move.
 *   3. `replay`        — a golden log replays to a byte-identical state.
 *
 * A game that passes all three is very unlikely to strand a real table.
 */
import { Rng } from "../rng";
import type {
  AnyGameDefinition,
  BaseState,
  BotLevel,
  GameEvent,
  Seat,
  SeatId
} from "../types";

export interface SimOptions {
  seats?: number;
  seed?: string;
  config?: unknown;
  level?: BotLevel;
  /** Safety valve: a game that exceeds this is considered stuck. */
  maxPly?: number;
  /** Run the game's own invariant hook after every move. */
  checkInvariants?: boolean;
}

export interface SimResult {
  seed: string;
  ply: number;
  terminal: boolean;
  winner: SeatId[];
  scores: { seat: SeatId; total: number }[];
  events: number;
  ms: number;
  error?: string;
  /** Move log, sufficient to replay the game exactly. */
  log: { seat: SeatId; move: unknown }[];
}

export function makeBotSeats(count: number, level: BotLevel = 2): Seat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    playerId: `bot:${i}`,
    name: `Bot ${i + 1}`,
    isBot: true,
    botLevel: level
  }));
}

/** Play one full bot-vs-bot game. Never throws — failures land in `error`. */
export function simulate(def: AnyGameDefinition, opts: SimOptions = {}): SimResult {
  const seatCount = opts.seats ?? def.meta.minPlayers;
  const seed = opts.seed ?? `sim-${def.id}-${seatCount}`;
  const level: BotLevel = opts.level ?? 2;
  const maxPly = opts.maxPly ?? 4000;
  const seats = makeBotSeats(seatCount, level);
  const started = Date.now();
  const log: { seat: SeatId; move: unknown }[] = [];

  const config = def.configSchema.parse(opts.config ?? {});
  let state = def.createState(config, seats, seed) as BaseState;
  const botRng = new Rng(`${seed}:bots`);
  let events = 0;
  let ply = 0;

  try {
    while (!def.isTerminal(state) && ply < maxPly) {
      const actors = def.currentSeats(state);
      if (actors.length === 0) {
        return fail("no current seat and game is not terminal");
      }
      const seat = actors[0]!;
      const legal = def.legalMoves(state, seat);
      if (legal.length === 0) {
        return fail(`seat ${seat} is to act but has no legal moves`);
      }
      const view = def.redactStateFor(state, seat);
      const move = def.bot(view, legal, botRng, level);
      if (move === undefined || move === null) {
        return fail(`bot returned no move for seat ${seat}`);
      }
      const res = def.applyMove(state, seat, move);
      if (!res.ok) {
        return fail(`bot played an illegal move (${res.error.code}: ${res.error.message})`);
      }
      state = res.value.state as BaseState;
      events += res.value.events.length;
      log.push({ seat, move });
      ply++;

      if (opts.checkInvariants !== false && def.invariants) {
        const problem = def.invariants(state);
        if (typeof problem === "string") return fail(`invariant: ${problem}`);
      }
    }
  } catch (e) {
    return fail(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
  }

  const terminal = def.isTerminal(state);
  const scores = terminal ? def.score(state) : [];
  return {
    seed,
    ply,
    terminal,
    winner: scores.filter((s) => s.won).map((s) => s.seat),
    scores: scores.map((s) => ({ seat: s.seat, total: s.total })),
    events,
    ms: Date.now() - started,
    log
  };

  function fail(error: string): SimResult {
    return {
      seed,
      ply,
      terminal: false,
      winner: [],
      scores: [],
      events,
      ms: Date.now() - started,
      error,
      log
    };
  }
}

export interface SimBatchResult {
  games: number;
  ok: number;
  failures: SimResult[];
  avgPly: number;
  avgMs: number;
  /** Wins per seat — a sanity check on seat fairness / bot symmetry. */
  winsBySeat: Record<number, number>;
}

export function simulateMany(
  def: AnyGameDefinition,
  count: number,
  opts: SimOptions = {}
): SimBatchResult {
  const failures: SimResult[] = [];
  const winsBySeat: Record<number, number> = {};
  let plySum = 0;
  let msSum = 0;
  let ok = 0;
  for (let i = 0; i < count; i++) {
    const r = simulate(def, { ...opts, seed: `${opts.seed ?? def.id}#${i}` });
    plySum += r.ply;
    msSum += r.ms;
    if (r.error || !r.terminal) {
      failures.push(r);
    } else {
      ok++;
      for (const w of r.winner) winsBySeat[w] = (winsBySeat[w] ?? 0) + 1;
    }
  }
  return { games: count, ok, failures, avgPly: plySum / count, avgMs: msSum / count, winsBySeat };
}

/* --------------------------------------------------------------- replays */

export interface ReplayInput {
  seats: Seat[];
  seed: string;
  config?: unknown;
  log: { seat: SeatId; move: unknown }[];
}

export interface ReplayResult {
  state: BaseState;
  events: GameEvent[];
  /** Stable hash of the final state — the golden value CI compares. */
  fingerprint: string;
}

/** Replay a move log from scratch. Throws on the first divergence. */
export function replay(def: AnyGameDefinition, input: ReplayInput): ReplayResult {
  const config = def.configSchema.parse(input.config ?? {});
  let state = def.createState(config, input.seats, input.seed) as BaseState;
  const events: GameEvent[] = [];
  input.log.forEach((entry, i) => {
    const res = def.applyMove(state, entry.seat, entry.move);
    if (!res.ok) {
      throw new Error(
        `replay diverged at ply ${i} (seat ${entry.seat}): ${res.error.code} ${res.error.message}`
      );
    }
    state = res.value.state as BaseState;
    events.push(...res.value.events);
  });
  return { state, events, fingerprint: fingerprint(state) };
}

/** Order-independent, stable JSON hash of a state. */
export function fingerprint(value: unknown): string {
  const json = stableStringify(value);
  // FNV-1a 64-bit-ish, expressed in two 32-bit halves for portability.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/* ------------------------------------------------------------ properties */

export interface PropertyReport {
  checked: number;
  violations: string[];
}

/**
 * Property harness: walks random legal lines and asserts the platform-level
 * invariants that hold for EVERY game, plus the game's own `invariants`.
 */
export function checkProperties(
  def: AnyGameDefinition,
  opts: SimOptions & { lines?: number } = {}
): PropertyReport {
  const violations: string[] = [];
  const lines = opts.lines ?? 20;
  let checked = 0;

  for (let l = 0; l < lines; l++) {
    const seatCount = opts.seats ?? def.meta.minPlayers;
    const seats = makeBotSeats(seatCount);
    const seed = `${opts.seed ?? def.id}:prop:${l}`;
    const config = def.configSchema.parse(opts.config ?? {});
    let state = def.createState(config, seats, seed) as BaseState;
    const rng = new Rng(`${seed}:walk`);
    const maxPly = opts.maxPly ?? 400;

    for (let p = 0; p < maxPly && !def.isTerminal(state); p++) {
      const actors = def.currentSeats(state);
      if (actors.length === 0) {
        violations.push(`[${seed}] no current seat at ply ${p} but game is not terminal`);
        break;
      }
      const seat = rng.pick(actors);
      const legal = def.legalMoves(state, seat);
      if (legal.length === 0) {
        violations.push(`[${seed}] seat ${seat} is to act at ply ${p} with zero legal moves`);
        break;
      }

      // Property: redaction never widens. A viewer's view must not contain the
      // full state object identity, and spectator views must be derivable.
      for (const s of state.seatCount ? range(state.seatCount) : []) {
        const view = def.redactStateFor(state, s);
        if (view === (state as unknown)) {
          violations.push(`[${seed}] redactStateFor(seat ${s}) returned the raw state`);
        }
      }

      // Property: illegal moves are rejected, not applied.
      const before = fingerprint(state);
      const bogus = { __gambitIllegalProbe: true } as unknown;
      try {
        const rej = def.applyMove(state, seat, bogus);
        if (rej.ok) {
          violations.push(`[${seed}] a nonsense move was accepted at ply ${p}`);
        } else if (fingerprint(state) !== before) {
          violations.push(`[${seed}] a rejected move mutated the state at ply ${p}`);
        }
      } catch (e) {
        violations.push(
          `[${seed}] applyMove threw on a malformed move instead of returning an error: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }

      const move = rng.pick(legal);
      const res = def.applyMove(state, seat, move);
      if (!res.ok) {
        violations.push(
          `[${seed}] legalMoves offered a move applyMove rejected at ply ${p}: ${res.error.code}`
        );
        break;
      }
      // Property: applyMove is pure — the input state is untouched.
      if (fingerprint(state) !== before) {
        violations.push(`[${seed}] applyMove mutated its input state at ply ${p}`);
      }
      state = res.value.state as BaseState;
      checked++;

      if (def.invariants) {
        const problem = def.invariants(state);
        if (typeof problem === "string") violations.push(`[${seed}] invariant at ply ${p}: ${problem}`);
      }
      if (violations.length > 25) return { checked, violations };
    }
  }
  return { checked, violations };
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * Redaction snapshot helper: asserts that no string in `secrets` appears
 * anywhere in the serialized view handed to `viewer`. Used by the Phantom and
 * Motive leak tests, and worth running for every hidden-information game.
 */
export function assertNoLeak(
  def: AnyGameDefinition,
  state: BaseState,
  viewer: SeatId | "spectator",
  secrets: (string | number)[]
): string[] {
  const view = JSON.stringify(def.redactStateFor(state, viewer));
  const leaks: string[] = [];
  for (const s of secrets) {
    const needle = JSON.stringify(s);
    if (view.includes(needle.slice(1, -1)) || view.includes(needle)) {
      leaks.push(`viewer ${viewer} can see secret ${String(s)}`);
    }
  }
  return leaks;
}
