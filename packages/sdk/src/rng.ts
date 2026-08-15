/**
 * Deterministic, server-seeded RNG.
 *
 * Every source of randomness in every Gambit game flows through this file:
 * dice, shuffles, bag draws, secret spawns. Clients never roll — they receive
 * results. Because the generator is a pure function of (seed, call sequence),
 * replays are exact and the audit trail is verifiable.
 */

/** xmur3 string hash → 32-bit seed material. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** sfc32 — small, fast, good statistical quality, trivially portable. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export interface RngState {
  seed: string;
  /** Number of raw draws consumed so far. Serialized with game state. */
  cursor: number;
}

export class Rng {
  readonly seed: string;
  private cursor: number;
  private next: () => number;

  constructor(seed: string, cursor = 0) {
    this.seed = seed;
    this.cursor = 0;
    const h = xmur3(seed);
    this.next = sfc32(h(), h(), h(), h());
    // Fast-forward to the recorded position so a rehydrated state continues
    // the same stream it was on.
    for (let i = 0; i < cursor; i++) this.raw();
  }

  static from(state: RngState): Rng {
    return new Rng(state.seed, state.cursor);
  }

  serialize(): RngState {
    return { seed: this.seed, cursor: this.cursor };
  }

  /** Raw float in [0, 1). */
  raw(): number {
    this.cursor++;
    return this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    if (n <= 0) throw new Error(`Rng.int requires n > 0, got ${n}`);
    return Math.floor(this.raw() * n);
  }

  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** A single die of `sides` faces, 1-indexed. */
  die(sides = 6): number {
    return 1 + this.int(sides);
  }

  /** `count` dice, each `sides` faces. */
  dice(count: number, sides = 6): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(this.die(sides));
    return out;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty array");
    return items[this.int(items.length)] as T;
  }

  /** Fisher–Yates, returns a new array; the input is never mutated. */
  shuffle<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = a[i] as T;
      a[i] = a[j] as T;
      a[j] = t;
    }
    return a;
  }

  /** Deal `n` items off the front of a pile. Returns [taken, rest]. */
  deal<T>(pile: readonly T[], n: number): [T[], T[]] {
    const take = Math.min(n, pile.length);
    return [pile.slice(0, take), pile.slice(take)];
  }
}

/** Cryptographically-ish unique room/game seed. Server-side only. */
export function makeSeed(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
