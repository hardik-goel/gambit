/** Small, boring utilities that every game reaches for. */
import type { BaseState, PendingInput, SeatId, FinalScore } from "./types";

export const nextSeat = (seat: SeatId, count: number): SeatId => (seat + 1) % count;
export const prevSeat = (seat: SeatId, count: number): SeatId => (seat - 1 + count) % count;

/** Seat order starting after `seat`, wrapping, excluding `seat` itself. */
export function clockwiseFrom(seat: SeatId, count: number): SeatId[] {
  const out: SeatId[] = [];
  for (let i = 1; i < count; i++) out.push((seat + i) % count);
  return out;
}

/** Structured clone that also works on older runtimes. */
export function clone<T>(v: T): T {
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

export function pushPending<S extends BaseState>(state: S, input: PendingInput): S {
  return { ...state, pending: [...state.pending, input] };
}

export function resolvePending<S extends BaseState>(state: S, id: string): S {
  return { ...state, pending: state.pending.filter((p) => p.id !== id) };
}

export function pendingFor(state: BaseState, seat: SeatId): PendingInput[] {
  return state.pending.filter((p) => p.seat === seat);
}

/** Deterministic pending-input ids: ply-scoped, never Date.now(). */
export function pendingId(state: BaseState, kind: string, seat: SeatId): string {
  return `${kind}:${seat}:${state.ply}`;
}

/** Rank a list of (seat, total) with a tiebreak chain; higher is better. */
export function rankScores(
  entries: { seat: SeatId; total: number; lines: { label: string; value: number }[] }[],
  tiebreak: (a: SeatId, b: SeatId) => number = () => 0
): FinalScore[] {
  const sorted = entries.slice().sort((a, b) => b.total - a.total || tiebreak(a.seat, b.seat));
  const out: FinalScore[] = [];
  let rank = 0;
  let lastKey = "";
  sorted.forEach((e, i) => {
    const key = `${e.total}`;
    const tied = i > 0 && key === lastKey && tiebreak(sorted[i - 1]!.seat, e.seat) === 0;
    if (!tied) rank = i + 1;
    lastKey = key;
    out.push({ seat: e.seat, total: e.total, lines: e.lines, rank, won: false });
  });
  const best = out.length ? Math.min(...out.map((o) => o.rank)) : 0;
  for (const o of out) o.won = o.rank === best;
  return out;
}

/** Count occurrences by key. */
export function tally<T, K extends string | number>(items: readonly T[], key: (t: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const it of items) {
    const k = key(it);
    out[k] = ((out[k] ?? 0) as number) + 1;
  }
  return out;
}

/** Union-find over string keys — Hamlet regions, Boxcar networks, Stronghold paths. */
export class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(k: string): void {
    if (!this.parent.has(k)) {
      this.parent.set(k, k);
      this.rank.set(k, 0);
    }
  }

  find(k: string): string {
    this.add(k);
    let root = k;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    // path compression
    let cur = k;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): string {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return ra;
    const rka = this.rank.get(ra)!;
    const rkb = this.rank.get(rb)!;
    if (rka < rkb) { this.parent.set(ra, rb); return rb; }
    if (rka > rkb) { this.parent.set(rb, ra); return ra; }
    this.parent.set(rb, ra);
    this.rank.set(ra, rka + 1);
    return ra;
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }

  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const k of this.parent.keys()) {
      const r = this.find(k);
      const list = out.get(r) ?? [];
      list.push(k);
      out.set(r, list);
    }
    return out;
  }
}

/** Breadth-first shortest path length over an adjacency map; -1 if unreachable. */
export function bfsDistance(
  adj: Map<string, string[]>,
  from: string,
  to: string
): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length) {
    d++;
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of adj.get(n) ?? []) {
        if (m === to) return d;
        if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
    }
    frontier = next;
  }
  return -1;
}
