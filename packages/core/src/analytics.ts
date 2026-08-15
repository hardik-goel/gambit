/**
 * Analytics — the short list of things worth measuring, and nothing else.
 *
 * Every event here answers a question the product actually asks: are people
 * getting seated fast enough, are tables finishing, does the tutorial work, is
 * the share card doing its job. No page-by-page surveillance, no third party,
 * no identifiers beyond the room and the game.
 */

export type AnalyticsEvent =
  | { name: "room_created"; gameId: string; mode: "here" | "online" | "quick" }
  | { name: "time_to_seated"; ms: number; players: number; mode: "here" | "online" | "quick" }
  | { name: "game_started"; gameId: string; players: number; bots: number }
  | { name: "game_finished"; gameId: string; players: number; minutes: number }
  | { name: "move_latency"; gameId: string; ms: number }
  | { name: "tutorial_started"; gameId: string }
  | { name: "tutorial_completed"; gameId: string; steps: number }
  | { name: "share_card"; gameId: string; how: "shared" | "downloaded" }
  | { name: "rematch"; gameId: string }
  | { name: "reconnected"; gameId: string; missedEvents: number };

type Sink = (event: AnalyticsEvent & { at: number }) => void;

const sinks: Sink[] = [];

/** Where events go. In development that is the console; in production, one call. */
export function addAnalyticsSink(sink: Sink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

export function track(event: AnalyticsEvent): void {
  const stamped = { ...event, at: Date.now() };
  for (const sink of sinks) {
    try {
      sink(stamped);
    } catch {
      // Analytics must never be able to break a game.
    }
  }
}

/**
 * Percentiles over a rolling window — enough to watch the move-latency budget
 * without shipping every sample anywhere.
 */
export class Percentiles {
  private samples: number[] = [];
  constructor(private readonly limit = 500) {}

  add(value: number): void {
    this.samples.push(value);
    if (this.samples.length > this.limit) this.samples.shift();
  }

  at(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[index]!;
  }

  get count(): number {
    return this.samples.length;
  }
}
