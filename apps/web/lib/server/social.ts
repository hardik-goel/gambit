/**
 * Profiles, friends, blocks and invites.
 *
 * In development this is three maps beside the rooms; in production the same
 * six functions read and write `profiles`, `friendships` and `reports`. The
 * engine only ever asks one question of any of it — `blocked(a, b)` — which is
 * why the rest can live up here.
 *
 * Nothing here stores an email, a phone number or a photograph. A profile is a
 * name, an emoji and a six-character code you can read out across a room.
 */
import {
  defaultAvatar,
  makeFriendCode,
  normalizeFriendCode,
  recentPlayers,
  type Friendship,
  type Profile,
  type RoomInvite,
  type SocialPort
} from "@gambit/core";

interface SocialState {
  profiles: Map<string, Profile>;
  byFriendCode: Map<string, string>;
  friendships: Friendship[];
  /** blocker → set of blocked. */
  blocks: Map<string, Set<string>>;
  invites: RoomInvite[];
  results: { seats: { playerId: string; name: string }[]; finishedAt: number; gameId: string }[];
}

const g = globalThis as typeof globalThis & { __gambitSocial?: SocialState };
if (!g.__gambitSocial) {
  g.__gambitSocial = {
    profiles: new Map(),
    byFriendCode: new Map(),
    friendships: [],
    blocks: new Map(),
    invites: [],
    results: []
  };
}
const state = g.__gambitSocial;

/* ------------------------------------------------------------- profiles */

export function getProfile(playerId: string, fallbackName = "Guest"): Profile {
  const existing = state.profiles.get(playerId);
  if (existing) return existing;

  let code = makeFriendCode();
  for (let i = 0; i < 8 && state.byFriendCode.has(code); i++) code = makeFriendCode();
  const profile: Profile = {
    playerId,
    name: fallbackName,
    avatar: defaultAvatar(playerId),
    friendCode: code,
    createdAt: Date.now()
  };
  state.profiles.set(playerId, profile);
  state.byFriendCode.set(code, playerId);
  return profile;
}

export function updateProfile(playerId: string, patch: { name?: string; avatar?: string }): Profile {
  const profile = getProfile(playerId);
  if (patch.name !== undefined) profile.name = patch.name.slice(0, 24).trim() || profile.name;
  // One emoji, and only an emoji: a name in the avatar slot is how you smuggle
  // a second name past a moderation queue that only reads names.
  if (patch.avatar !== undefined && [...patch.avatar].length === 1) profile.avatar = patch.avatar;
  return profile;
}

export const profileByFriendCode = (code: string): Profile | null => {
  const id = state.byFriendCode.get(normalizeFriendCode(code));
  return id ? getProfile(id) : null;
};

export const profileOf = (playerId: string): Profile | null => state.profiles.get(playerId) ?? null;

/**
 * The name to show at a table. A profile wins over the cookie, so renaming
 * yourself in the people panel renames you everywhere at once.
 */
export const displayName = (playerId: string, fallback: string): string =>
  state.profiles.get(playerId)?.name ?? fallback;

/* -------------------------------------------------------------- friends */

const pairKey = (a: string, b: string): string => [a, b].sort().join("|");

export function friendshipBetween(a: string, b: string): Friendship | null {
  return (
    state.friendships.find((f) => pairKey(f.requesterId, f.addresseeId) === pairKey(a, b)) ?? null
  );
}

export function requestFriend(from: string, to: string): { ok: true } | { ok: false; message: string } {
  if (from === to) return { ok: false, message: "You're already your own best company." };
  if (isBlocked(from, to)) return { ok: false, message: "You can't add that player." };
  const existing = friendshipBetween(from, to);
  if (existing?.status === "accepted") return { ok: false, message: "You're already friends." };
  if (existing) {
    // They asked first: treat this as an acceptance rather than a second request.
    if (existing.addresseeId === from) existing.status = "accepted";
    return { ok: true };
  }
  state.friendships.push({ requesterId: from, addresseeId: to, status: "pending", createdAt: Date.now() });
  return { ok: true };
}

export function answerFriend(me: string, other: string, accept: boolean): boolean {
  const friendship = friendshipBetween(me, other);
  if (!friendship || friendship.status !== "pending" || friendship.addresseeId !== me) return false;
  if (accept) friendship.status = "accepted";
  else removeFriend(me, other);
  return true;
}

export function removeFriend(a: string, b: string): void {
  state.friendships = state.friendships.filter(
    (f) => pairKey(f.requesterId, f.addresseeId) !== pairKey(a, b)
  );
}

export const friendsOf = (playerId: string): Profile[] =>
  state.friendships
    .filter((f) => f.status === "accepted" && (f.requesterId === playerId || f.addresseeId === playerId))
    .map((f) => getProfile(f.requesterId === playerId ? f.addresseeId : f.requesterId));

export const requestsFor = (playerId: string): { from: Profile; at: number }[] =>
  state.friendships
    .filter((f) => f.status === "pending" && f.addresseeId === playerId)
    .map((f) => ({ from: getProfile(f.requesterId), at: f.createdAt }));

export const requestsFrom = (playerId: string): Profile[] =>
  state.friendships
    .filter((f) => f.status === "pending" && f.requesterId === playerId)
    .map((f) => getProfile(f.addresseeId));

/* --------------------------------------------------------------- blocks */

export function block(blocker: string, blocked: string): void {
  if (blocker === blocked) return;
  const set = state.blocks.get(blocker) ?? new Set<string>();
  set.add(blocked);
  state.blocks.set(blocker, set);
  // Blocking somebody ends whatever else was between you.
  removeFriend(blocker, blocked);
}

export function unblock(blocker: string, blocked: string): void {
  state.blocks.get(blocker)?.delete(blocked);
}

export const isBlocked = (a: string, b: string): boolean =>
  Boolean(state.blocks.get(a)?.has(b) || state.blocks.get(b)?.has(a));

export const blocksOf = (playerId: string): Profile[] =>
  [...(state.blocks.get(playerId) ?? [])].map((id) => getProfile(id));

/** The port the engine sees: one question, no product concerns. */
export const socialPort: SocialPort = { blocked: isBlocked };

/* -------------------------------------------------------------- invites */

export function inviteFriend(invite: RoomInvite): void {
  if (isBlocked(invite.from, invite.to)) return;
  // One live invite per pair per room, newest wins.
  state.invites = state.invites.filter(
    (i) => !(i.from === invite.from && i.to === invite.to && i.roomId === invite.roomId)
  );
  state.invites.push(invite);
  // Invites are a nudge, not an inbox: an hour old is old enough.
  const hourAgo = Date.now() - 60 * 60 * 1000;
  state.invites = state.invites.filter((i) => i.at > hourAgo);
}

export const invitesFor = (playerId: string): (RoomInvite & { fromProfile: Profile })[] =>
  state.invites
    .filter((i) => i.to === playerId && !isBlocked(playerId, i.from))
    .map((i) => ({ ...i, fromProfile: getProfile(i.from) }));

export const clearInvite = (playerId: string, roomId: string): void => {
  state.invites = state.invites.filter((i) => !(i.to === playerId && i.roomId === roomId));
};

/* -------------------------------------------------------- recent players */

export function rememberResult(gameId: string, seats: { playerId: string; name: string }[]): void {
  state.results.push({ gameId, seats, finishedAt: Date.now() });
  if (state.results.length > 500) state.results.shift();
}

export const recentFor = (playerId: string) => recentPlayers(state.results, playerId);

/* ------------------------------------------------------- data protection */

/** Everything the social layer holds about one person. */
export function exportSocial(playerId: string): Record<string, unknown> {
  return {
    profile: state.profiles.get(playerId) ?? null,
    friends: friendsOf(playerId).map((p) => ({ playerId: p.playerId, name: p.name })),
    requestsReceived: requestsFor(playerId).map((r) => ({ from: r.from.name, at: r.at })),
    requestsSent: requestsFrom(playerId).map((p) => p.name),
    blocked: [...(state.blocks.get(playerId) ?? [])],
    invites: state.invites.filter((i) => i.to === playerId || i.from === playerId),
    playedWith: recentFor(playerId)
  };
}

/**
 * Erase one person from the social layer.
 *
 * Their own record goes entirely. What is *shared* — a friendship, a game they
 * played in — is unlinked rather than rewritten, because a finished game is
 * also the other players' record of their evening and deleting it would take
 * their history away with yours.
 */
export function eraseSocial(playerId: string): void {
  const profile = state.profiles.get(playerId);
  if (profile) state.byFriendCode.delete(profile.friendCode);
  state.profiles.delete(playerId);

  state.friendships = state.friendships.filter(
    (f) => f.requesterId !== playerId && f.addresseeId !== playerId
  );
  state.blocks.delete(playerId);
  for (const set of state.blocks.values()) set.delete(playerId);
  state.invites = state.invites.filter((i) => i.to !== playerId && i.from !== playerId);

  // Past tables keep their shape; the person in them becomes nobody.
  for (const result of state.results) {
    for (const seat of result.seats) {
      if (seat.playerId === playerId) {
        seat.playerId = `erased:${Math.random().toString(36).slice(2, 10)}`;
        seat.name = "Former player";
      }
    }
  }
}
