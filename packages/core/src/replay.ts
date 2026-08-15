/**
 * Replay theatre.
 *
 * Because every game is deterministic given (seed, seats, move log), a finished
 * table can be rebuilt move by move from the log alone — for the scrubber, for
 * share links, and for settling any argument about what actually happened.
 */
import type { AnyGameDefinition, FinalScore, GameEvent, Seat, SeatId } from "@gambit/sdk";
import type { StoredMove } from "./room";

export interface ReplayFrame {
  ply: number;
  seat: SeatId | null;
  /** Public view at this point; replays never reveal what was hidden in play. */
  view: unknown;
  events: GameEvent[];
  description: string;
}

export interface ReplayOptions {
  /** Watch as a seat (post-game, everything is public anyway) or as spectator. */
  viewer?: SeatId | "spectator";
}

export function buildReplay(
  def: AnyGameDefinition,
  input: { seats: Seat[]; seed: string; config?: unknown; moves: StoredMove[] },
  opts: ReplayOptions = {}
): { frames: ReplayFrame[]; scores: FinalScore[] } {
  const viewer = opts.viewer ?? "spectator";
  const config = def.configSchema.parse(input.config ?? {});
  let state = def.createState(config, input.seats, input.seed);
  const frames: ReplayFrame[] = [
    {
      ply: 0,
      seat: null,
      view: def.redactStateFor(state, viewer),
      events: [],
      description: "Game begins."
    }
  ];

  input.moves.forEach((m, i) => {
    const res = def.applyMove(state, m.seat, m.move);
    if (!res.ok) {
      frames.push({
        ply: i + 1,
        seat: m.seat,
        view: def.redactStateFor(state, viewer),
        events: [],
        description: `Replay stopped: ${res.error.message}`
      });
      return;
    }
    state = res.value.state;
    frames.push({
      ply: i + 1,
      seat: m.seat,
      view: def.redactStateFor(state, viewer),
      events: res.value.events,
      description:
        def.describeMove?.(state, m.seat, m.move) ??
        res.value.events.find((e) => e.text)?.text ??
        `Seat ${m.seat + 1} moved.`
    });
  });

  return { frames, scores: def.isTerminal(state) ? def.score(state) : [] };
}
