"use client";
/**
 * The Motive table: the mansion above, your notepad below.
 *
 * The notepad marks itself for anything you can prove — your own cards, what
 * you have been shown, the face-up leftovers — and lets you mark the rest with
 * a tick, a cross or a question. Those manual marks never leave your device.
 */
import { motion } from "framer-motion";
import React, { useEffect, useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import {
  DOORS,
  IMPLEMENTS,
  ROOMS,
  SIZE,
  SUSPECTS,
  cardById,
  implementCard,
  isCorridor,
  roomAt,
  roomCard,
  suspectCard
} from "./mansion";
import type { MotiveMove, MotiveView } from "./state";

const SEAT_HEX = ["#b0342a", "#2f5f9e", "#3d7a45", "#c9a227", "#6b4f9e", "#2e2a26"];
type Mark = "" | "✔" | "✘" | "?";

export function Board({ view, legal, seat, play, sfx }: BoardProps<MotiveView, MotiveMove>) {
  const mySeat = seat ?? view.turn;
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [suggestion, setSuggestion] = useState<{ suspect: number; implement: number }>({
    suspect: 0,
    implement: 0
  });
  const [accusing, setAccusing] = useState(false);
  const [accusation, setAccusation] = useState({ suspect: 0, implement: 0, room: 0 });

  // The manual half of the notepad lives on the device only.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gambit.motive.notepad");
      if (saved) setMarks(JSON.parse(saved) as Record<string, Mark>);
    } catch {
      /* private mode */
    }
  }, []);
  const mark = (card: string) => {
    const order: Mark[] = ["", "✔", "✘", "?"];
    const next = order[(order.indexOf(marks[card] ?? "") + 1) % order.length]!;
    const updated = { ...marks, [card]: next };
    setMarks(updated);
    try {
      localStorage.setItem("gambit.motive.notepad", JSON.stringify(updated));
    } catch {
      /* ignore */
    }
  };

  const moves = useMemo(
    () => legal.filter((m): m is Extract<MotiveMove, { kind: "move" }> => m.kind === "move"),
    [legal]
  );
  const suggestions = legal.filter((m) => m.kind === "suggest");
  const accusations = legal.filter((m): m is Extract<MotiveMove, { kind: "accuse" }> => m.kind === "accuse");
  const shows = legal.filter((m): m is Extract<MotiveMove, { kind: "show" }> => m.kind === "show");
  const passage = legal.find((m) => m.kind === "passage");
  const stay = legal.find((m) => m.kind === "stay");
  const endTurn = legal.find((m) => m.kind === "end-turn");

  const cell = 30;
  const targetAt = (x: number, y: number) =>
    moves.find((m) => m.to.kind === "cell" && m.to.x === x && m.to.y === y);
  const roomTarget = (room: number) => moves.find((m) => m.to.kind === "room" && m.to.room === room);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 14, width: "min(96vw, 760px)", maxWidth: "100%" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span style={{ color: "var(--accent)" }}>
          round {view.round}/{view.maxRounds}
        </span>
        {view.roll !== null && !view.moved && <span>you rolled {view.roll}</span>}
        {view.eliminated.includes(mySeat) && <span style={{ color: "var(--mut)" }}>you accused, and were wrong</span>}
        {passage && (
          <button className="gambit-mini" onClick={() => play(passage)}>
            Take the secret passage
          </button>
        )}
        {stay && (
          <button className="gambit-mini" onClick={() => play(stay)}>
            Stay in this room
          </button>
        )}
        {endTurn && (
          <button className="gambit-mini" onClick={() => play(endTurn)}>
            End turn
          </button>
        )}
      </div>

      {shows.length > 0 && (
        <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--accent)", background: "var(--panel)" }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>{view.pending?.prompt}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {shows.map((m) => (
              <button
                key={m.card}
                className="gambit-mini"
                onClick={() => {
                  sfx("cardSlip");
                  play(m);
                }}
              >
                Show the {cardById(m.card).name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* the house */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${SIZE}, ${cell}px)`,
          gap: 1,
          justifyContent: "center",
          background: "var(--felt)",
          padding: 10,
          borderRadius: 12,
          border: "1px solid var(--line)"
        }}
      >
        {Array.from({ length: SIZE * SIZE }, (_, i) => {
          const x = i % SIZE;
          const y = Math.floor(i / SIZE);
          const room = roomAt(x, y);
          const corridor = isCorridor(x, y);
          const door = DOORS.some((d) => d.x === x && d.y === y);
          const move = corridor ? targetAt(x, y) : room !== null ? roomTarget(room) : undefined;
          const pawnHere = Object.entries(view.pawns).find(([, p]) =>
            p.kind === "cell" ? p.x === x && p.y === y : room !== null && p.room === room
          );
          const roomLabelCell = room !== null && x % 4 === 1 && y % 4 === 1;

          return (
            <button
              key={i}
              onClick={() => {
                if (!move) return;
                sfx("pieceSet");
                play(move);
              }}
              aria-label={room !== null ? ROOMS[room] : `corridor ${x},${y}`}
              style={{
                width: cell,
                height: cell,
                padding: 0,
                fontSize: 8,
                lineHeight: 1.05,
                border: move ? "2px solid var(--accent)" : "1px solid var(--line)",
                background:
                  room !== null ? "var(--panel)" : door ? "var(--backing)" : "var(--panel2)",
                color: "var(--ink)",
                cursor: move ? "pointer" : "default",
                position: "relative",
                overflow: "hidden"
              }}
            >
              {roomLabelCell && <span style={{ opacity: 0.75 }}>{ROOMS[room!]}</span>}
              {pawnHere && (
                <motion.span
                  layout
                  style={{
                    position: "absolute",
                    inset: "20%",
                    borderRadius: "50%",
                    background: SEAT_HEX[Number(pawnHere[0]) % SEAT_HEX.length],
                    border: "1px solid rgba(0,0,0,.5)"
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* making a suggestion */}
      {suggestions.length > 0 && (
        <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 10, background: "var(--panel)" }}>
          <div style={{ fontSize: 13, color: "var(--mut)" }}>
            Suggest, in this room:
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SUSPECTS.map((name, i) => (
              <button
                key={name}
                className="gambit-mini"
                style={suggestion.suspect === i ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
                onClick={() => setSuggestion((s) => ({ ...s, suspect: i }))}
              >
                {name}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {IMPLEMENTS.map((name, i) => (
              <button
                key={name}
                className="gambit-mini"
                style={suggestion.implement === i ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
                onClick={() => setSuggestion((s) => ({ ...s, implement: i }))}
              >
                {name}
              </button>
            ))}
          </div>
          <button
            className="gambit-mini"
            style={{ justifySelf: "start", borderColor: "var(--accent)" }}
            onClick={() => {
              sfx("nudge");
              play({ kind: "suggest", ...suggestion });
            }}
          >
            Put it to the table
          </button>
        </div>
      )}

      {/* the notepad */}
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: "var(--mut)" }}>NOTEPAD</div>
          {accusations.length > 0 && (
            <button className="gambit-mini" onClick={() => setAccusing((a) => !a)}>
              {accusing ? "Not yet" : "Make an accusation"}
            </button>
          )}
        </div>

        {(
          [
            ["Suspects", SUSPECTS, suspectCard],
            ["Implements", IMPLEMENTS, implementCard],
            ["Rooms", ROOMS, roomCard]
          ] as const
        ).map(([label, list, toCard]) => (
          <div key={label}>
            <div style={{ fontSize: 11, color: "var(--mut)", marginBottom: 4 }}>{label}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {list.map((name, i) => {
                const card = toCard(i);
                const known = view.cleared.includes(card);
                return (
                  <button
                    key={card}
                    onClick={() => !known && mark(card)}
                    className="gambit-mini"
                    style={{
                      opacity: known ? 0.45 : 1,
                      textDecoration: known ? "line-through" : undefined,
                      borderColor: marks[card] === "✔" ? "var(--accent)" : "var(--line)"
                    }}
                  >
                    {name} {known ? "✘" : (marks[card] ?? "")}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {accusing && (
          <div style={{ display: "grid", gap: 6, padding: 12, borderRadius: 10, border: "1px solid #b1503f" }}>
            <div style={{ fontSize: 13 }}>
              Name all three. Get it wrong and you play no further part.
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SUSPECTS.map((name, i) => (
                <button key={name} className="gambit-mini" style={accusation.suspect === i ? { borderColor: "var(--accent)" } : {}} onClick={() => setAccusation((a) => ({ ...a, suspect: i }))}>
                  {name}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {IMPLEMENTS.map((name, i) => (
                <button key={name} className="gambit-mini" style={accusation.implement === i ? { borderColor: "var(--accent)" } : {}} onClick={() => setAccusation((a) => ({ ...a, implement: i }))}>
                  {name}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ROOMS.map((name, i) => (
                <button key={name} className="gambit-mini" style={accusation.room === i ? { borderColor: "var(--accent)" } : {}} onClick={() => setAccusation((a) => ({ ...a, room: i }))}>
                  {name}
                </button>
              ))}
            </div>
            <button
              className="gambit-mini"
              style={{ justifySelf: "start", borderColor: "#b1503f", color: "#d1685c" }}
              disabled={!accusations.some(
                (m) =>
                  m.suspect === accusation.suspect &&
                  m.implement === accusation.implement &&
                  m.room === accusation.room
              )}
              onClick={() => {
                sfx("reveal");
                play({ kind: "accuse", ...accusation });
                setAccusing(false);
              }}
            >
              Accuse
            </button>
          </div>
        )}
      </div>

      {/* what the table has heard */}
      <div style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--mut)" }}>
        {view.history.slice(-6).map((h, i) => (
          <div key={i}>
            {view.names[h.by]} asked about {SUSPECTS[h.suspect]} · {IMPLEMENTS[h.implement]} ·{" "}
            {ROOMS[h.room]} —{" "}
            {h.shownBy !== null
              ? `${view.names[h.shownBy]} answered`
              : h.passed.length
                ? "nobody could answer"
                : "…"}
          </div>
        ))}
      </div>
    </div>
  );
}
