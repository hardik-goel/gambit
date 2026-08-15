/**
 * The move pipeline — the single authoritative path a move can take.
 *
 *   auth → snapshot → applyMove → append (versioned, idempotent)
 *        → per-seat redacted broadcast → bot follow-up
 *
 * Clients apply their own moves optimistically for feel, but this is the truth.
 * A rejection here rolls the client back with the game's own one-line reason.
 */
import {
  Rng,
  makeSeed,
  type AnyGameDefinition,
  type BotLevel,
  type FinalScore,
  type GameEvent,
  type Result,
  type Seat,
  type SeatId
} from "@gambit/sdk";
import { eventsFor, legalFor, viewFor } from "./redaction";
import { seatOf, seatsFromRoom, type Room, type Snapshot } from "./room";
import type { RoomStore } from "./store";
import { VersionConflictError } from "./store";
import type { Broadcaster } from "./transport";

export interface EngineDeps {
  store: RoomStore;
  catalog: Record<string, AnyGameDefinition>;
  broadcast: Broadcaster;
  now?: () => number;
}

const nowOf = (deps: EngineDeps) => deps.now?.() ?? Date.now();

export function gameFor(deps: EngineDeps, gameId: string): AnyGameDefinition {
  const def = deps.catalog[gameId];
  if (!def) throw new Error(`unknown game: ${gameId}`);
  return def;
}

const fail = <T>(code: string, message: string): Result<T> => ({
  ok: false,
  error: { code, message }
});

/* ------------------------------------------------------------------ start */

export async function startGame(
  deps: EngineDeps,
  roomId: string,
  byPlayerId: string
): Promise<Result<{ version: number }>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  if (room.hostId !== byPlayerId) return fail("not-host", "Only the host can start the game.");
  if (room.status === "playing") return fail("already-playing", "This game is already under way.");

  const def = gameFor(deps, room.gameId);
  const seats = seatsFromRoom(room);
  if (seats.length < def.meta.minPlayers) {
    return fail("too-few", `${def.meta.name} needs at least ${def.meta.minPlayers} players.`);
  }
  if (seats.length > def.meta.maxPlayers) {
    return fail("too-many", `${def.meta.name} seats at most ${def.meta.maxPlayers} players.`);
  }
  const notReady = room.players.filter((p) => p.seat !== null && !p.ready && !p.isBot);
  if (notReady.length > 0) {
    return fail("not-ready", `Waiting on ${notReady.map((p) => p.name).join(", ")}.`);
  }

  const parsed = def.configSchema.safeParse(room.config ?? {});
  if (!parsed.success) {
    return fail("bad-config", "Those table options aren't valid for this game.");
  }

  const seed = room.seed || makeSeed();
  const state = def.createState(parsed.data, seats, seed);
  const at = nowOf(deps);
  const opening: GameEvent[] = [
    { type: "game-started", text: `${def.meta.name} begins.`, sfx: "start" }
  ];

  const updated = await deps.store.updateRoom(roomId, {
    status: "playing",
    startedAt: at,
    seed,
    config: parsed.data as Record<string, unknown>
  });

  // `append` is the single writer of (version, state, events) — it persists the
  // opening snapshot too, so version and state can never drift apart.
  const appended = await deps.store.append({
    roomId,
    seat: null,
    events: opening,
    state,
    expectedVersion: 0
  });

  await broadcastState(
    deps,
    updated,
    def,
    state,
    opening,
    appended.version,
    appended.events.at(-1)?.seq ?? 0
  );
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });

  // If seat 0 is a bot, get it moving.
  void driveBots(deps, roomId);
  return { ok: true, value: { version: 1 } };
}

/* ------------------------------------------------------------------- move */

export interface MoveRequest {
  roomId: string;
  playerId: string;
  move: unknown;
  /** Client-generated; a retried request with the same key is a no-op. */
  idempotencyKey: string;
  /** Version the client believed it was on; informational, for diagnostics. */
  clientVersion?: number;
}

export interface MoveAck {
  version: number;
  seq: number;
  terminal: boolean;
}

export async function submitMove(deps: EngineDeps, req: MoveRequest): Promise<Result<MoveAck>> {
  const room = await deps.store.getRoom(req.roomId);
  if (!room) return fail("no-room", "That table no longer exists.");

  // Idempotency is checked before anything else: a retry of the move that
  // *ended* the game must still succeed, or a client that lost the response to
  // its own checkmate would be told it had done something wrong.
  const prior = await deps.store.findByIdempotencyKey(req.roomId, req.idempotencyKey);
  if (prior) {
    const snap = await deps.store.getSnapshot(req.roomId);
    return {
      ok: true,
      value: {
        version: snap?.version ?? 0,
        seq: prior.seq,
        terminal: room.status === "finished"
      }
    };
  }

  if (room.status !== "playing") return fail("not-playing", "This table isn't in play.");

  const def = gameFor(deps, room.gameId);
  let seat = seatOf(room, req.playerId);

  if (room.passAndPlay) {
    // One screen, many players: the device may act for whichever seat is up.
    const snap = await deps.store.getSnapshot(req.roomId);
    const current = snap ? def.currentSeats(snap.state) : [];
    if (seat === null || !current.includes(seat)) seat = current[0] ?? seat;
  }
  if (seat === null) return fail("no-seat", "You're spectating this table.");

  return commitMove(deps, room, def, seat, req.move, req.idempotencyKey);
}

/** Shared by human moves, bot moves and timeout takeovers. */
async function commitMove(
  deps: EngineDeps,
  room: Room,
  def: AnyGameDefinition,
  seat: SeatId,
  move: unknown,
  idempotencyKey: string
): Promise<Result<MoveAck>> {
  const snap = await deps.store.getSnapshot(room.id);
  if (!snap) return fail("no-state", "This table has no game in progress.");

  const current = def.currentSeats(snap.state);
  if (!current.includes(seat)) {
    return fail("not-your-turn", "It isn't your turn yet.");
  }

  // Every move carries the server's clock. Games that care about wall time
  // (chess clocks, turn deadlines) read `__at`; the rest ignore it. Stamping
  // here — not in the game — keeps `applyMove` pure and replays exact, because
  // the stamp is part of the logged move.
  const stamped =
    move && typeof move === "object" && !Array.isArray(move)
      ? { ...(move as Record<string, unknown>), __at: nowOf(deps) }
      : move;

  const res = def.applyMove(snap.state, seat, stamped);
  if (!res.ok) return { ok: false, error: res.error };

  const { state: nextState, events } = res.value;

  let appended;
  try {
    appended = await deps.store.append({
      roomId: room.id,
      seat,
      events,
      state: nextState,
      expectedVersion: snap.version,
      move: { seat, move: stamped, idempotencyKey }
    });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return fail("conflict", "Someone moved first — catching you up.");
    }
    throw e;
  }

  await broadcastState(deps, room, def, nextState, events, appended.version, appended.events.at(-1)?.seq ?? 0);

  const terminal = def.isTerminal(nextState);
  if (terminal) await finishGame(deps, room, def, nextState);

  if (!terminal) void driveBots(deps, room.id);

  return {
    ok: true,
    value: {
      version: appended.version,
      seq: appended.events.at(-1)?.seq ?? 0,
      terminal
    }
  };
}

/* -------------------------------------------------------------- broadcast */

export async function broadcastState(
  deps: EngineDeps,
  room: Room,
  def: AnyGameDefinition,
  state: unknown,
  events: GameEvent[],
  version = 1,
  seq = 0
): Promise<void> {
  const current = def.currentSeats(state);
  const terminal = def.isTerminal(state);
  const seats = seatsFromRoom(room);

  for (const s of seats) {
    await deps.broadcast.toSeat(room.id, s.id, {
      type: "delta",
      version,
      seq,
      events: eventsFor(events, s.id),
      view: viewFor(def, state, s.id),
      current,
      legal: legalFor(def, state, s.id),
      terminal
    });
  }
  await deps.broadcast.toSpectators(room.id, {
    type: "delta",
    version,
    seq,
    events: eventsFor(events, "spectator"),
    view: viewFor(def, state, "spectator"),
    current,
    legal: [],
    terminal
  });
}

/* ----------------------------------------------------------------- finish */

export async function finishGame(
  deps: EngineDeps,
  room: Room,
  def: AnyGameDefinition,
  state: unknown
): Promise<FinalScore[]> {
  const scores = def.score(state);
  const at = nowOf(deps);
  await deps.store.updateRoom(room.id, { status: "finished", finishedAt: at });
  await deps.store.recordResult(room.id, {
    gameId: room.gameId,
    seed: room.seed,
    scores,
    seats: seatsFromRoom(room),
    finishedAt: at
  });
  deps.broadcast.toRoom(room.id, { type: "finished", scores });
  return scores;
}

/* ------------------------------------------------------------------- bots */

const MAX_BOT_CHAIN = 500;

/**
 * Play out every consecutive bot seat. Runs after each human move, so a table
 * of one human and four bots never waits on anything but the human.
 */
export async function driveBots(deps: EngineDeps, roomId: string): Promise<void> {
  for (let i = 0; i < MAX_BOT_CHAIN; i++) {
    const room = await deps.store.getRoom(roomId);
    if (!room || room.status !== "playing") return;
    const def = gameFor(deps, room.gameId);
    const snap = await deps.store.getSnapshot(roomId);
    if (!snap) return;
    if (def.isTerminal(snap.state)) return;

    const current = def.currentSeats(snap.state);
    const seats = seatsFromRoom(room);
    const botSeat = current.find((s) => seats.find((x) => x.id === s)?.isBot);
    if (botSeat === undefined) return;

    const level: BotLevel = (seats.find((x) => x.id === botSeat)?.botLevel ?? 2) as BotLevel;
    const move = pickBotMove(def, snap, botSeat, level, room.seed);
    if (move === undefined) return;

    const res = await commitMove(
      deps,
      room,
      def,
      botSeat,
      move,
      `bot:${roomId}:${snap.version}:${botSeat}`
    );
    if (!res.ok) return; // a bot that can't move must not spin the loop
  }
}

export function pickBotMove(
  def: AnyGameDefinition,
  snap: Snapshot,
  seat: SeatId,
  level: BotLevel,
  seed: string
): unknown {
  const legal = def.legalMoves(snap.state, seat);
  if (legal.length === 0) return undefined;
  // Bot randomness is seeded per (game seed, version, seat): deterministic
  // replays survive bot participation.
  const rng = new Rng(`${seed}:bot:${snap.version}:${seat}`);
  const view = def.redactStateFor(snap.state, seat);
  try {
    return def.bot(view, legal, rng, level);
  } catch {
    return legal[rng.int(legal.length)];
  }
}

/**
 * Timeout takeover: a seat that sits past the table's clock has the bot play
 * one move for it. The human reclaims the seat simply by moving again.
 */
export async function takeOverIdleSeat(
  deps: EngineDeps,
  roomId: string,
  seat: SeatId
): Promise<Result<MoveAck>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  const def = gameFor(deps, room.gameId);
  const snap = await deps.store.getSnapshot(roomId);
  if (!snap) return fail("no-state", "This table has no game in progress.");
  const move = pickBotMove(def, snap, seat, 1, room.seed);
  if (move === undefined) return fail("no-move", "Nothing to play for that seat.");
  return commitMove(deps, room, def, seat, move, `timeout:${roomId}:${snap.version}:${seat}`);
}

/* -------------------------------------------------------------- snapshots */

export interface ClientSnapshot {
  room: Room;
  gameId: string;
  seat: SeatId | null;
  version: number;
  seq: number;
  view: unknown;
  legal: unknown[];
  current: SeatId[];
  terminal: boolean;
  scores?: FinalScore[];
  /** Public event history, redacted — powers reconnect and the ticker. */
  history: GameEvent[];
}

/** Everything a (re)joining client needs in one round trip. */
export async function clientSnapshot(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  sinceSeq = 0
): Promise<ClientSnapshot | null> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return null;
  const def = gameFor(deps, room.gameId);
  const snap = await deps.store.getSnapshot(roomId);
  const seat = seatOf(room, playerId);
  const viewer = seat ?? "spectator";
  const stored = await deps.store.getEventsSince(roomId, sinceSeq);
  const history = eventsFor(stored.map((s) => s.event), viewer);

  if (!snap) {
    return {
      room,
      gameId: room.gameId,
      seat,
      version: 0,
      seq: stored.at(-1)?.seq ?? sinceSeq,
      view: null,
      legal: [],
      current: [],
      terminal: false,
      history
    };
  }

  const terminal = def.isTerminal(snap.state);
  return {
    room,
    gameId: room.gameId,
    seat,
    version: snap.version,
    seq: stored.at(-1)?.seq ?? sinceSeq,
    view: viewFor(def, snap.state, viewer),
    legal: legalFor(def, snap.state, viewer),
    current: def.currentSeats(snap.state),
    terminal,
    scores: terminal ? def.score(snap.state) : undefined,
    history
  };
}
