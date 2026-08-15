/**
 * The Motive bot.
 *
 * It keeps the notepad a player would keep — its own cards, everything it has
 * been shown, the face-up leftovers — and then does the part that separates a
 * good player from a poor one: it listens. A player who could not disprove a
 * suggestion holds none of those three cards, and a suggestion nobody could
 * disprove is very nearly the answer.
 *
 * It suggests to test what it is least sure of, and accuses when one answer is
 * left standing.
 */
import type { BotLevel, Rng } from "@gambit/sdk";
import { IMPLEMENTS, ROOMS, SUSPECTS, implementCard, roomCard, suspectCard } from "./mansion";
import type { MotiveMove, MotiveView } from "./state";

export interface Notepad {
  /** Cards this seat can prove are not in the case file. */
  cleared: Set<string>;
  suspects: number[];
  implements: number[];
  rooms: number[];
  /** Extra weight on cards an unanswered suggestion pointed at. */
  suspicion: Map<string, number>;
}

export function notepad(view: MotiveView): Notepad {
  const cleared = new Set(view.cleared);
  const suspicion = new Map<string, number>();
  const seat = view.seat === "spectator" ? view.turn : view.seat;

  for (const record of view.history) {
    const named = [
      suspectCard(record.suspect),
      implementCard(record.implement),
      roomCard(record.room)
    ];
    // A suggestion nobody could answer, made by someone else, and holding none
    // of the three yourself: every one of them is either in that player's hand
    // or in the case file. That is the loudest signal in the game.
    if (record.shownBy === null && record.by !== seat) {
      const mine = named.filter((card) => cleared.has(card)).length;
      if (mine === 0) for (const card of named) suspicion.set(card, (suspicion.get(card) ?? 0) + 3);
      else for (const card of named) suspicion.set(card, (suspicion.get(card) ?? 0) + 0.5);
    }
    // Each pass narrows where a card can be, which raises the odds it is in the
    // file at all. A soft signal, but it accumulates.
    for (const card of named) {
      if (cleared.has(card)) continue;
      suspicion.set(card, (suspicion.get(card) ?? 0) + record.passed.length * 0.2);
    }
  }

  return {
    cleared,
    suspects: SUSPECTS.map((_, i) => i).filter((i) => !cleared.has(suspectCard(i))),
    implements: IMPLEMENTS.map((_, i) => i).filter((i) => !cleared.has(implementCard(i))),
    rooms: ROOMS.map((_, i) => i).filter((i) => !cleared.has(roomCard(i))),
    suspicion
  };
}

const best = (candidates: number[], toCard: (i: number) => string, pad: Notepad): number =>
  candidates
    .slice()
    .sort((a, b) => (pad.suspicion.get(toCard(b)) ?? 0) - (pad.suspicion.get(toCard(a)) ?? 0))[0] ??
  candidates[0] ??
  0;

export function bot(view: MotiveView, legal: MotiveMove[], rng: Rng, level: BotLevel): MotiveMove {
  if (legal.length <= 1) return legal[0]!;
  const pad = notepad(view);
  const seat = view.seat === "spectator" ? view.turn : view.seat;

  /* -------------------------------------------------- answering a question */
  const shows = legal.filter((m): m is Extract<MotiveMove, { kind: "show" }> => m.kind === "show");
  if (shows.length) {
    if (level === 1) return rng.pick(shows);
    // Show something you have already shown this player if you can — it tells
    // them nothing new. Otherwise a room card, the easiest thing to re-derive.
    const alreadySeen = shows.find((m) => view.seen.some((s) => s.card === m.card));
    return alreadySeen ?? shows.find((m) => m.card.startsWith("r")) ?? shows[0]!;
  }

  /* --------------------------------------------------------- the accusation */
  const accusations = legal.filter((m): m is Extract<MotiveMove, { kind: "accuse" }> => m.kind === "accuse");
  if (accusations.length) {
    const sure =
      pad.suspects.length === 1 && pad.implements.length === 1 && pad.rooms.length === 1;
    if (sure) {
      const move = accusations.find(
        (m) => m.suspect === pad.suspects[0] && m.implement === pad.implements[0] && m.room === pad.rooms[0]
      );
      if (move) return move;
    }
    // Late in the night, a strong hunch beats going home with nothing.
    const late = view.round >= view.maxRounds - 6;
    const confident =
      level >= 2 &&
      pad.suspects.length <= 2 &&
      pad.implements.length <= 2 &&
      pad.rooms.length <= 2 &&
      view.seen.length >= 4;
    if (late || confident) {
      const pick = accusations.find(
        (m) =>
          m.suspect === best(pad.suspects, suspectCard, pad) &&
          m.implement === best(pad.implements, implementCard, pad) &&
          m.room === best(pad.rooms, roomCard, pad)
      );
      if (pick) return pick;
    }
  }

  /* ---------------------------------------------------------- the question */
  const suggestions = legal.filter((m): m is Extract<MotiveMove, { kind: "suggest" }> => m.kind === "suggest");
  if (suggestions.length) {
    const open = suggestions.filter(
      (m) => pad.suspects.includes(m.suspect) && pad.implements.includes(m.implement)
    );
    const pool = open.length ? open : suggestions;
    if (level === 1) return pool[rng.int(pool.length)]!;
    // Ask about the pair you know least about.
    const scored = pool
      .map((m) => ({
        move: m,
        score:
          (pad.suspicion.get(suspectCard(m.suspect)) ?? 0) +
          (pad.suspicion.get(implementCard(m.implement)) ?? 0) +
          rng.raw()
      }))
      .sort((a, b) => b.score - a.score);
    return scored[0]!.move;
  }

  /* ----------------------------------------------------------- getting about */
  const moves = legal.filter((m): m is Extract<MotiveMove, { kind: "move" }> => m.kind === "move");
  const passage = legal.find((m) => m.kind === "passage");
  const stay = legal.find((m) => m.kind === "stay");

  const here = view.pawns[seat];
  if (stay && here?.kind === "room" && pad.rooms.includes(here.room)) return stay;

  const rooms = moves.filter((m) => m.to.kind === "room");
  const wanted = rooms.filter((m) => pad.rooms.includes((m.to as { room: number }).room));
  if (wanted.length) return wanted[rng.int(wanted.length)]!;
  if (passage && level >= 2 && rooms.length === 0) return passage;
  if (rooms.length) return rooms[rng.int(rooms.length)]!;
  if (moves.length) return moves[rng.int(moves.length)]!;

  return legal.find((m) => m.kind === "end-turn") ?? legal[0]!;
}
