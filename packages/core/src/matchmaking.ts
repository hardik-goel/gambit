/**
 * Quick match.
 *
 * The rule is deliberately plain: sit down at the fullest table that still has
 * room, and open a new one only when there isn't a table to join. That fills
 * games rather than scattering people across half-empty rooms, and it means a
 * player who taps "quick match" twice in a row lands in the same place their
 * friend did.
 */
import type { Result } from "@gambit/sdk";
import { gameFor, type EngineDeps } from "./engine";
import type { Room } from "./room";
import { createRoom, joinRoom } from "./rooms";

export interface QuickMatchInput {
  gameId: string;
  player: { playerId: string; name: string; avatar?: string | null };
  /** Wait for this many humans before starting; defaults to the game's minimum. */
  target?: number;
}

export interface QuickMatchResult {
  room: Room;
  /** True when a new table had to be opened. */
  created: boolean;
  /** Seats still empty before the game can start. */
  waitingFor: number;
}

export async function quickMatch(
  deps: EngineDeps,
  input: QuickMatchInput
): Promise<Result<QuickMatchResult>> {
  const def = deps.catalog[input.gameId];
  if (!def) {
    return { ok: false, error: { code: "unknown-game", message: "That game isn't on the shelf." } };
  }
  const target = Math.min(input.target ?? def.meta.minPlayers, def.meta.maxPlayers);

  const open = (await deps.store.listOpenRooms(input.gameId))
    .filter((room) => {
      if (room.passAndPlay) return false; // a same-room table isn't a public one
      const seated = room.players.filter((p) => p.seat !== null && !p.isBot).length;
      return seated > 0 && seated < def.meta.maxPlayers;
    })
    // Fullest first: finish a table before starting another.
    .sort(
      (a, b) =>
        b.players.filter((p) => p.seat !== null).length - a.players.filter((p) => p.seat !== null).length
    );

  const existing = open[0];
  if (existing) {
    const joined = await joinRoom(deps, existing.id, input.player);
    if (!joined.ok) return joined;
    const seated = joined.value.players.filter((p) => p.seat !== null).length;
    return {
      ok: true,
      value: { room: joined.value, created: false, waitingFor: Math.max(0, target - seated) }
    };
  }

  const created = await createRoom(deps, { gameId: input.gameId, host: input.player });
  if (!created.ok) return created;
  return {
    ok: true,
    value: { room: created.value, created: true, waitingFor: Math.max(0, target - 1) }
  };
}

/** How many people are waiting for a game right now, per game. */
export async function lobbyCounts(deps: EngineDeps): Promise<Record<string, number>> {
  const rooms = await deps.store.listOpenRooms();
  const counts: Record<string, number> = {};
  for (const room of rooms) {
    const waiting = room.players.filter((p) => p.seat !== null && !p.isBot).length;
    if (waiting === 0) continue;
    counts[room.gameId] = (counts[room.gameId] ?? 0) + waiting;
  }
  return counts;
}

export { gameFor };
