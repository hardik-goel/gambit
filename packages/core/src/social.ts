/**
 * The social port.
 *
 * Friends, profiles and blocking are a product concern, not a rules concern, so
 * almost all of them live above this line. What the platform genuinely needs to
 * know is one thing: whether two people have chosen not to be at a table
 * together. That answer changes who may join a room and who quick match will
 * seat you with, so it belongs behind a port like the store and the transport.
 *
 * A deployment with no social layer at all passes `undefined` and everything
 * behaves exactly as it did before.
 */
import type { SeatId } from "@gambit/sdk";

export interface Profile {
  playerId: string;
  name: string;
  /** A single emoji. No uploads, no hosting, no moderation queue. */
  avatar: string;
  /** Six characters, shared out loud, used to add somebody as a friend. */
  friendCode: string;
  createdAt: number;
}

export type FriendshipStatus = "pending" | "accepted";

export interface Friendship {
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: number;
}

export interface RoomInvite {
  from: string;
  to: string;
  roomId: string;
  code: string;
  gameId: string;
  at: number;
}

export interface SocialPort {
  /**
   * True when either of them has blocked the other. Blocking is symmetrical in
   * effect even though it is one-sided in intent: if you have blocked someone,
   * neither of you ends up at the other's table.
   */
  blocked(a: string, b: string): boolean;
}

/** Everyone at a table that this player will not sit with. */
export function blockedAtTable(
  social: SocialPort | undefined,
  playerId: string,
  others: { playerId: string }[]
): string[] {
  if (!social) return [];
  return others.filter((o) => o.playerId !== playerId && social.blocked(playerId, o.playerId)).map((o) => o.playerId);
}

/** Friend codes: same unambiguous alphabet as room codes, different length. */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY2346789";

export function makeFriendCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
}

export const normalizeFriendCode = (input: string): string =>
  input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

/** The emoji a new profile starts with, picked from the player id so it is stable. */
const AVATARS = ["🦊", "🦉", "🐇", "🐋", "🦌", "🐢", "🦡", "🦚", "🐈", "🦔", "🐉", "🦩"];
export const defaultAvatar = (playerId: string): string => {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length]!;
};
export const AVATAR_CHOICES = AVATARS;

/**
 * Who a player has played with lately, most recent first — the list that makes
 * "add friend" a single tap instead of a code exchange.
 */
export function recentPlayers(
  results: { seats: { playerId: string; name: string }[]; finishedAt: number; gameId: string }[],
  playerId: string,
  limit = 12
): { playerId: string; name: string; gameId: string; at: number }[] {
  const seen = new Map<string, { playerId: string; name: string; gameId: string; at: number }>();
  for (const result of [...results].sort((a, b) => b.finishedAt - a.finishedAt)) {
    for (const seat of result.seats) {
      if (seat.playerId === playerId) continue;
      if (seat.playerId.startsWith("bot:")) continue;
      if (seen.has(seat.playerId)) continue;
      seen.set(seat.playerId, {
        playerId: seat.playerId,
        name: seat.name,
        gameId: result.gameId,
        at: result.finishedAt
      });
    }
  }
  return [...seen.values()].slice(0, limit);
}

export type { SeatId };
