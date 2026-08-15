/** Lobby operations: create, join, seat, ready, bots, kick. Game-agnostic. */
import { makeSeed, type BotLevel, type Result, type SeatId } from "@gambit/sdk";
import { makeRoomCode } from "./codes";
import { gameFor, type EngineDeps } from "./engine";
import type { Room, RoomPlayer } from "./room";

const fail = <T>(code: string, message: string): Result<T> => ({ ok: false, error: { code, message } });
const nowOf = (deps: EngineDeps) => deps.now?.() ?? Date.now();

export interface CreateRoomInput {
  gameId: string;
  host: { playerId: string; name: string; avatar?: string | null };
  config?: Record<string, unknown>;
  passAndPlay?: boolean;
  turnTimeoutSec?: number;
}

export async function createRoom(deps: EngineDeps, input: CreateRoomInput): Promise<Result<Room>> {
  const def = deps.catalog[input.gameId];
  if (!def) return fail("unknown-game", "That game isn't on the shelf.");

  const parsed = def.configSchema.safeParse(input.config ?? {});
  if (!parsed.success) return fail("bad-config", "Those table options aren't valid for this game.");

  // Retry a handful of times in the vanishingly unlikely event of a collision.
  let code = makeRoomCode();
  for (let i = 0; i < 8 && (await deps.store.getRoomByCode(code)); i++) code = makeRoomCode();

  const at = nowOf(deps);
  const room: Room = {
    id: cryptoId(),
    code,
    gameId: input.gameId,
    hostId: input.host.playerId,
    status: "lobby",
    config: parsed.data as Record<string, unknown>,
    seed: makeSeed(),
    createdAt: at,
    turnTimeoutSec: input.turnTimeoutSec ?? 90,
    passAndPlay: input.passAndPlay ?? false,
    players: [
      {
        playerId: input.host.playerId,
        name: input.host.name,
        avatar: input.host.avatar ?? null,
        seat: 0,
        ready: false,
        isHost: true,
        isBot: false,
        seenAt: at,
        connected: true
      }
    ]
  };
  const saved = await deps.store.createRoom(room);
  return { ok: true, value: saved };
}

export async function joinRoom(
  deps: EngineDeps,
  roomId: string,
  player: { playerId: string; name: string; avatar?: string | null }
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  const def = gameFor(deps, room.gameId);
  const at = nowOf(deps);

  const existing = room.players.find((p) => p.playerId === player.playerId);
  if (existing) {
    // Reconnect: keep the seat, refresh presence.
    const updated = await deps.store.upsertPlayer(roomId, {
      ...existing,
      name: player.name || existing.name,
      seenAt: at,
      connected: true
    });
    deps.broadcast.toRoom(roomId, { type: "room", room: updated });
    return { ok: true, value: updated };
  }

  const seated = room.players.filter((p) => p.seat !== null).length;
  const canSit = room.status === "lobby" && seated < def.meta.maxPlayers;
  const seat = canSit ? nextFreeSeat(room, def.meta.maxPlayers) : null;

  const updated = await deps.store.upsertPlayer(roomId, {
    playerId: player.playerId,
    name: player.name,
    avatar: player.avatar ?? null,
    seat,
    ready: false,
    isHost: false,
    isBot: false,
    seenAt: at,
    connected: true
  });
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

export async function takeSeat(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  seat: SeatId | null
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  if (room.status !== "lobby") return fail("in-play", "Seats are locked once the game starts.");
  const def = gameFor(deps, room.gameId);
  if (seat !== null && (seat < 0 || seat >= def.meta.maxPlayers)) {
    return fail("bad-seat", `${def.meta.name} only has ${def.meta.maxPlayers} seats.`);
  }
  if (seat !== null && room.players.some((p) => p.seat === seat && p.playerId !== playerId)) {
    return fail("seat-taken", "Someone's already sitting there.");
  }
  const me = room.players.find((p) => p.playerId === playerId);
  if (!me) return fail("not-in-room", "Join the table first.");
  const updated = await deps.store.upsertPlayer(roomId, { ...me, seat, ready: false });
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

export async function setTeam(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  team: string | undefined
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  const me = room.players.find((p) => p.playerId === playerId);
  if (!me) return fail("not-in-room", "Join the table first.");
  const updated = await deps.store.upsertPlayer(roomId, { ...me, team });
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

export async function setReady(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  ready: boolean
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  const me = room.players.find((p) => p.playerId === playerId);
  if (!me) return fail("not-in-room", "Join the table first.");
  const updated = await deps.store.upsertPlayer(roomId, { ...me, ready });
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

export async function setConfig(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  config: Record<string, unknown>
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  if (room.hostId !== playerId) return fail("not-host", "Only the host can change table options.");
  const def = gameFor(deps, room.gameId);
  const parsed = def.configSchema.safeParse({ ...room.config, ...config });
  if (!parsed.success) return fail("bad-config", "That option isn't valid for this game.");
  const updated = await deps.store.updateRoom(roomId, {
    config: parsed.data as Record<string, unknown>
  });
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

export async function setGame(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  gameId: string
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  if (room.hostId !== playerId) return fail("not-host", "Only the host can change the game.");
  if (room.status === "playing") return fail("in-play", "Finish this game first.");
  const def = deps.catalog[gameId];
  if (!def) return fail("unknown-game", "That game isn't on the shelf.");
  const config = def.configSchema.parse({}) as Record<string, unknown>;
  const updated = await deps.store.updateRoom(roomId, { gameId, config, status: "lobby" });
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

export async function addBot(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  level: BotLevel = 2
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  if (room.hostId !== playerId) return fail("not-host", "Only the host can add bots.");
  const def = gameFor(deps, room.gameId);
  const seat = nextFreeSeat(room, def.meta.maxPlayers);
  if (seat === null) return fail("full", "Every seat is taken.");
  const at = nowOf(deps);
  const updated = await deps.store.upsertPlayer(roomId, {
    playerId: `bot:${seat}:${at}`,
    name: BOT_NAMES[seat % BOT_NAMES.length] as string,
    avatar: null,
    seat,
    ready: true,
    isHost: false,
    isBot: true,
    botLevel: level,
    seenAt: at,
    connected: true
  });
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

/** Fill every remaining seat up to the game's minimum (or a target count). */
export async function fillWithBots(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  target?: number,
  level: BotLevel = 2
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  const def = gameFor(deps, room.gameId);
  const want = Math.min(target ?? def.meta.minPlayers, def.meta.maxPlayers);
  let last: Room = room;
  for (let i = 0; i < def.meta.maxPlayers; i++) {
    const seated = last.players.filter((p) => p.seat !== null).length;
    if (seated >= want) break;
    const res = await addBot(deps, roomId, playerId, level);
    if (!res.ok) return res;
    last = res.value;
  }
  return { ok: true, value: last };
}

export async function kick(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  targetId: string
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  if (room.hostId !== playerId) return fail("not-host", "Only the host can remove players.");
  if (targetId === room.hostId) return fail("not-host", "The host can't be removed.");
  const updated = await deps.store.removePlayer(roomId, targetId);
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

export async function heartbeat(
  deps: EngineDeps,
  roomId: string,
  playerId: string,
  connected = true
): Promise<void> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return;
  const me = room.players.find((p) => p.playerId === playerId);
  if (!me) return;
  const at = nowOf(deps);
  if (me.connected === connected && at - me.seenAt < 5_000) return;
  await deps.store.upsertPlayer(roomId, { ...me, seenAt: at, connected });
  deps.broadcast.toRoom(roomId, { type: "presence", playerId, connected, at });
}

/** Rematch: same table, same seats, fresh seed. */
export async function rematch(
  deps: EngineDeps,
  roomId: string,
  playerId: string
): Promise<Result<Room>> {
  const room = await deps.store.getRoom(roomId);
  if (!room) return fail("no-room", "That table no longer exists.");
  if (room.hostId !== playerId) return fail("not-host", "Only the host can call a rematch.");
  const updated = await deps.store.updateRoom(roomId, {
    status: "lobby",
    seed: makeSeed(),
    startedAt: undefined,
    finishedAt: undefined
  });
  deps.broadcast.toRoom(roomId, { type: "room", room: updated });
  return { ok: true, value: updated };
}

function nextFreeSeat(room: Room, maxSeats: number): SeatId | null {
  const taken = new Set(room.players.map((p) => p.seat).filter((s): s is number => s !== null));
  for (let i = 0; i < maxSeats; i++) if (!taken.has(i)) return i;
  return null;
}

const BOT_NAMES = ["Ada", "Bishop", "Cinder", "Dovetail", "Ember", "Flint"];

function cryptoId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `room_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
