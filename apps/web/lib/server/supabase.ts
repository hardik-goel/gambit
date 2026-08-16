/**
 * The production store and broadcaster.
 *
 * This is the same `RoomStore` and `Broadcaster` the dev server implements in
 * memory, backed by Postgres and Realtime. Nothing above it changes: the move
 * pipeline, redaction, reconnection and replay are identical whichever of the
 * two is wired in.
 *
 * Two things are worth knowing when reading it:
 *
 *  - Writes go through the service role. A client can never insert a move or a
 *    game state; it can only ask the API to, and the API runs the engine.
 *  - `append` is a single RPC (`append_game_events`) so the version check, the
 *    event rows, the move row and the new state land in one transaction. That
 *    is what makes optimistic concurrency work under real contention.
 *
 * Not exercised by CI — there is no Supabase project in the test environment.
 * `pnpm exec tsx scripts/e2e.ts` runs the same pipeline against the memory
 * store, and the SQL in `supabase/migrations` is what this file talks to.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  VersionConflictError,
  type AppendInput,
  type AppendOutput,
  type Broadcaster,
  type Room,
  type RoomPlayer,
  type RoomStore,
  type ServerMessage,
  type Snapshot,
  type StoredEvent,
  type StoredMove
} from "@gambit/core";
import type { SeatId } from "@gambit/sdk";

export const hasSupabase = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Which schema Gambit's tables live in.
 *
 * `public` when the project is Gambit's own. When the project is shared with
 * another product, `GAMBIT_DB_SCHEMA=gambit` keeps the two sets of tables from
 * ever meeting — see `scripts/db-migrate.ts`. The value must match what the
 * migration was applied with, and the schema must be listed under Settings →
 * API → Exposed schemas.
 */
export const dbSchema = (): string => process.env.GAMBIT_DB_SCHEMA?.trim() || "public";

/**
 * A client whose schema is decided at runtime.
 *
 * `SupabaseClient` defaults its schema parameter to the literal `"public"`,
 * which is exactly the assumption we are removing, so the schema is widened to
 * `string` here and nowhere else.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated
// Database type does not exist here; rows are typed at each call site instead.
type GambitClient = SupabaseClient<any, string, string>;

export function serviceClient(): GambitClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      db: { schema: dbSchema() },
      realtime: { params: { eventsPerSecond: 20 } }
    }
  );
}

interface RoomRow {
  id: string;
  code: string;
  game_id: string;
  host_id: string;
  status: Room["status"];
  config: Record<string, unknown>;
  seed: string;
  pass_and_play: boolean;
  turn_timeout_sec: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface PlayerRow {
  room_id: string;
  player_id: string;
  seat: number | null;
  team: string | null;
  ready: boolean;
  is_host: boolean;
  is_bot: boolean;
  bot_level: number | null;
  seen_at: string;
  connected: boolean;
  profiles?: { display_name: string; avatar_url: string | null } | null;
}

const toRoom = (row: RoomRow, players: PlayerRow[]): Room => ({
  id: row.id,
  code: row.code,
  gameId: row.game_id,
  hostId: row.host_id,
  status: row.status,
  config: row.config ?? {},
  seed: row.seed,
  passAndPlay: row.pass_and_play,
  turnTimeoutSec: row.turn_timeout_sec,
  createdAt: Date.parse(row.created_at),
  startedAt: row.started_at ? Date.parse(row.started_at) : undefined,
  finishedAt: row.finished_at ? Date.parse(row.finished_at) : undefined,
  players: players.map((p) => ({
    playerId: p.player_id,
    name: p.profiles?.display_name ?? "Guest",
    avatar: p.profiles?.avatar_url ?? null,
    seat: p.seat,
    team: p.team ?? undefined,
    ready: p.ready,
    isHost: p.is_host,
    isBot: p.is_bot,
    botLevel: (p.bot_level ?? undefined) as RoomPlayer["botLevel"],
    seenAt: Date.parse(p.seen_at),
    connected: p.connected
  }))
});

export class SupabaseRoomStore implements RoomStore {
  constructor(private readonly db: GambitClient = serviceClient()) {}

  private async load(where: "id" | "code", value: string): Promise<Room | null> {
    const { data: room } = await this.db
      .from("rooms")
      .select("*")
      .eq(where, value)
      .maybeSingle<RoomRow>();
    if (!room) return null;
    const { data: players } = await this.db
      .from("room_players")
      .select("*, profiles(display_name, avatar_url)")
      .eq("room_id", room.id);
    return toRoom(room, (players ?? []) as PlayerRow[]);
  }

  async createRoom(room: Room): Promise<Room> {
    await this.db.from("rooms").insert({
      id: room.id,
      code: room.code,
      game_id: room.gameId,
      host_id: room.hostId,
      status: room.status,
      config: room.config,
      seed: room.seed,
      pass_and_play: room.passAndPlay,
      turn_timeout_sec: room.turnTimeoutSec
    });
    for (const player of room.players) await this.upsertPlayer(room.id, player);
    return (await this.getRoom(room.id)) ?? room;
  }

  getRoom(id: string): Promise<Room | null> {
    return this.load("id", id);
  }

  getRoomByCode(code: string): Promise<Room | null> {
    return this.load("code", code.toUpperCase());
  }

  async updateRoom(id: string, patch: Partial<Room>): Promise<Room> {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.config !== undefined) row.config = patch.config;
    if (patch.seed !== undefined) row.seed = patch.seed;
    if (patch.gameId !== undefined) row.game_id = patch.gameId;
    if (patch.turnTimeoutSec !== undefined) row.turn_timeout_sec = patch.turnTimeoutSec;
    if ("startedAt" in patch) row.started_at = patch.startedAt ? new Date(patch.startedAt).toISOString() : null;
    if ("finishedAt" in patch) row.finished_at = patch.finishedAt ? new Date(patch.finishedAt).toISOString() : null;
    if (Object.keys(row).length) await this.db.from("rooms").update(row).eq("id", id);
    const room = await this.getRoom(id);
    if (!room) throw new Error(`unknown room: ${id}`);
    return room;
  }

  async upsertPlayer(roomId: string, player: RoomPlayer): Promise<Room> {
    await this.db.from("room_players").upsert(
      {
        room_id: roomId,
        player_id: player.playerId,
        seat: player.seat,
        team: player.team ?? null,
        ready: player.ready,
        is_host: player.isHost,
        is_bot: player.isBot,
        bot_level: player.botLevel ?? null,
        seen_at: new Date(player.seenAt).toISOString(),
        connected: player.connected
      },
      { onConflict: "room_id,player_id" }
    );
    const room = await this.getRoom(roomId);
    if (!room) throw new Error(`unknown room: ${roomId}`);
    return room;
  }

  async removePlayer(roomId: string, playerId: string): Promise<Room> {
    await this.db.from("room_players").delete().eq("room_id", roomId).eq("player_id", playerId);
    const room = await this.getRoom(roomId);
    if (!room) throw new Error(`unknown room: ${roomId}`);
    return room;
  }

  async getSnapshot(roomId: string): Promise<Snapshot | null> {
    const { data } = await this.db
      .from("games")
      .select("version, state, updated_at")
      .eq("room_id", roomId)
      .maybeSingle<{ version: number; state: unknown; updated_at: string }>();
    if (!data) return null;
    return {
      roomId,
      version: data.version,
      state: data.state,
      updatedAt: Date.parse(data.updated_at)
    };
  }

  async putSnapshot(snap: Snapshot): Promise<void> {
    await this.db.from("games").upsert({
      room_id: snap.roomId,
      version: snap.version,
      state: snap.state,
      updated_at: new Date(snap.updatedAt).toISOString()
    });
  }

  /** One transaction: check the version, write the events, the move and the state. */
  async append(input: AppendInput): Promise<AppendOutput> {
    const { data, error } = await this.db.rpc("append_game_events", {
      p_room_id: input.roomId,
      p_expected: input.expectedVersion,
      p_state: input.state,
      p_events: input.events,
      p_seat: input.seat,
      p_move: input.move?.move ?? null,
      p_key: input.move?.idempotencyKey ?? null
    });

    if (error) {
      // 40001 is the serialization failure the function raises on a stale read.
      if (error.code === "40001" || error.message.includes("version conflict")) {
        const snap = await this.getSnapshot(input.roomId);
        throw new VersionConflictError(input.expectedVersion, snap?.version ?? -1);
      }
      throw new Error(error.message);
    }

    const row = (data as { version: number; first_seq: number; last_seq: number }[] | null)?.[0];
    const version = row?.version ?? input.expectedVersion + 1;
    const firstSeq = row?.first_seq ?? 0;
    const at = Date.now();

    return {
      version,
      events: input.events.map((event, i) => ({
        seq: firstSeq + i,
        roomId: input.roomId,
        seat: input.seat,
        event,
        version,
        at
      }))
    };
  }

  async getEventsSince(roomId: string, seq: number): Promise<StoredEvent[]> {
    const { data } = await this.db
      .from("game_events")
      .select("seq, seat, version, event, at")
      .eq("room_id", roomId)
      .gt("seq", seq)
      .order("seq", { ascending: true });
    return (data ?? []).map((row) => ({
      seq: row.seq as number,
      roomId,
      seat: row.seat as SeatId | null,
      event: row.event as StoredEvent["event"],
      version: row.version as number,
      at: Date.parse(row.at as string)
    }));
  }

  async getMoves(roomId: string): Promise<StoredMove[]> {
    const { data } = await this.db
      .from("game_moves")
      .select("seq, seat, move, idempotency_key, at")
      .eq("room_id", roomId)
      .order("seq", { ascending: true });
    return (data ?? []).map((row) => ({
      seq: row.seq as number,
      seat: row.seat as SeatId,
      move: row.move,
      idempotencyKey: row.idempotency_key as string,
      at: Date.parse(row.at as string)
    }));
  }

  async findByIdempotencyKey(roomId: string, key: string): Promise<StoredMove | null> {
    const { data } = await this.db
      .from("game_moves")
      .select("seq, seat, move, idempotency_key, at")
      .eq("room_id", roomId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (!data) return null;
    return {
      seq: data.seq as number,
      seat: data.seat as SeatId,
      move: data.move,
      idempotencyKey: data.idempotency_key as string,
      at: Date.parse(data.at as string)
    };
  }

  async listOpenRooms(gameId?: string): Promise<Room[]> {
    let query = this.db.from("rooms").select("id").eq("status", "lobby").limit(50);
    if (gameId) query = query.eq("game_id", gameId);
    const { data } = await query;
    const rooms = await Promise.all((data ?? []).map((row) => this.getRoom(row.id as string)));
    return rooms.filter((r): r is Room => r !== null);
  }

  async listPlayingRooms(): Promise<Room[]> {
    const { data } = await this.db.from("rooms").select("id").eq("status", "playing").limit(200);
    const rooms = await Promise.all((data ?? []).map((row) => this.getRoom(row.id as string)));
    return rooms.filter((r): r is Room => r !== null);
  }

  async recordResult(roomId: string, result: unknown): Promise<void> {
    const payload = result as { gameId: string; seed: string; scores: unknown; seats: unknown };
    await this.db.from("game_results").insert({
      room_id: roomId,
      game_id: payload.gameId,
      seed: payload.seed,
      scores: payload.scores,
      seats: payload.seats
    });
  }
}

/**
 * Realtime broadcast. Per-seat channels are the only ones that carry hidden
 * information, and a client may only subscribe to its own — the channel name
 * contains the room and the seat, and the API hands a client its seat only
 * after checking who they are.
 */
export function supabaseBroadcaster(db: GambitClient = serviceClient()): Broadcaster {
  const send = async (channelName: string, msg: ServerMessage) => {
    const channel = db.channel(channelName, { config: { broadcast: { self: true } } });
    await channel.send({ type: "broadcast", event: "gambit", payload: msg });
  };
  return {
    toSeat: (roomId, seat, msg) => send(`room:${roomId}:seat:${seat}`, msg),
    toSpectators: (roomId, msg) => send(`room:${roomId}:spectators`, msg),
    toRoom: (roomId, msg) => send(`room:${roomId}`, msg)
  };
}
