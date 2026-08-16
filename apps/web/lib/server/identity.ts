/**
 * Identity, minimal by design (DPDP: collect nothing you don't need).
 *
 * A player is a random id in a cookie plus a display name. Accounts —
 * email OTP, Google, Apple — layer on top in Phase F and simply replace the
 * `playerId` with the profile id; nothing else changes.
 */
import { cookies } from "next/headers";

export const PID_COOKIE = "gambit_pid";
export const NAME_COOKIE = "gambit_name";

const NAMES = [
  "Quiet Rook", "Copper Fox", "Lamplight", "Blue Marble", "Night Porter",
  "Tin Whistle", "Old Brass", "Paper Kite", "Slow Train", "Velvet Chair"
];

export interface Identity {
  playerId: string;
  name: string;
}

/**
 * A player id is a uuid and nothing else.
 *
 * It used to carry a `p_` prefix, which read nicely and could never be stored:
 * every column that holds a player id is a `uuid`, so the prefix made the
 * production schema unusable by the product. The prefix is gone; ids that
 * still have one are treated as absent, and the holder is issued a new one.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPlayerId = (value: string): boolean => UUID.test(value);

/**
 * The cookie carries a name so that a first-time visitor has one before they
 * have a profile. Once a profile exists it is the only source of truth — see
 * `displayName` in `social.ts`, which every room-facing route uses.
 */

export async function readIdentity(): Promise<Identity | null> {
  const jar = await cookies();
  const pid = jar.get(PID_COOKIE)?.value;
  if (!pid || !isPlayerId(pid)) return null;
  return { playerId: pid, name: jar.get(NAME_COOKIE)?.value ?? "Guest" };
}

/** Read the caller's identity, minting one on first contact. */
export async function requireIdentity(): Promise<Identity> {
  const existing = await readIdentity();
  if (existing) return existing;
  const jar = await cookies();
  const playerId = crypto.randomUUID();
  const name = NAMES[Math.floor(Math.random() * NAMES.length)] as string;
  const opts = {
    httpOnly: false, // the client reads its own id to address its private channel
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  };
  jar.set(PID_COOKIE, playerId, opts);
  jar.set(NAME_COOKIE, name, opts);
  return { playerId, name };
}

export async function setName(name: string): Promise<void> {
  const jar = await cookies();
  jar.set(NAME_COOKIE, name.slice(0, 24), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
}
