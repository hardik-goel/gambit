"use client";
/**
 * The chess table.
 *
 * Tap a piece, its legal squares light (from the engine — never guessed here),
 * tap a square, the piece is already moving before the server has heard about
 * it. Captures get a short hero beat; illegal taps get one line of English.
 */
import { motion } from "framer-motion";
import React, { useEffect, useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import { squareName, type Color } from "./rules";
import type { ChessMove, ChessView } from "./state";

const GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
};

export function Board({ view, legal, seat, play, sfx, reducedMotion, pending }: BoardProps<ChessView, ChessMove>) {
  const myColor: Color | null = seat !== null ? (view.colors[seat] ?? null) : null;
  const flipped = myColor === "b";
  const [from, setFrom] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);

  const moves = useMemo(
    () => legal.filter((m): m is Extract<ChessMove, { kind: "move" }> => m.kind === "move"),
    [legal]
  );
  const targets = useMemo(
    () => (from === null ? [] : moves.filter((m) => m.from === from).map((m) => m.to)),
    [moves, from]
  );
  const movable = useMemo(() => new Set(moves.map((m) => m.from)), [moves]);

  useEffect(() => {
    if (view.check) sfx("nudge");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.ply]);

  const order = useMemo(() => {
    const idx = Array.from({ length: 64 }, (_, i) => i);
    return flipped ? idx.reverse() : idx;
  }, [flipped]);

  function tap(sq: number) {
    const piece = view.board[sq] ?? "";
    if (from !== null && targets.includes(sq)) {
      const isPromotion = moves.some((m) => m.from === from && m.to === sq && m.promo);
      if (isPromotion) {
        setPromo({ from, to: sq });
        return;
      }
      sfx(view.board[sq] ? "capture" : "pieceSet");
      play({ kind: "move", from, to: sq });
      setFrom(null);
      return;
    }
    if (piece && movable.has(sq)) {
      setFrom(sq);
      sfx("select");
      return;
    }
    setFrom(null);
  }

  return (
    <div style={{ display: "grid", gap: 14, justifyItems: "center" }}>
      <Clocks view={view} myColor={myColor} />

      <div
        role="grid"
        aria-label="Chess board"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, 1fr)",
          width: "min(92vw, 560px)", maxWidth: "100%",
          aspectRatio: "1",
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)",
          position: "relative"
        }}
      >
        {order.map((sq) => {
          const f = sq % 8;
          const r = Math.floor(sq / 8);
          const light = (f + r) % 2 === 0;
          const piece = view.board[sq] ?? "";
          const isTarget = targets.includes(sq);
          const isFrom = from === sq;
          const isLast = view.lastMove && (view.lastMove.from === sq || view.lastMove.to === sq);
          const isCheckedKing =
            view.check && piece.toLowerCase() === "k" && (piece === "K") === (view.turn === "w");

          return (
            <button
              key={sq}
              role="gridcell"
              aria-label={`${squareName(sq)}${piece ? `, ${GLYPH[piece]}` : ", empty"}`}
              onClick={() => tap(sq)}
              style={{
                position: "relative",
                border: "none",
                padding: 0,
                cursor: movable.has(sq) || isTarget ? "pointer" : "default",
                background: light ? "#e9dcc3" : "#8a6a4a",
                boxShadow: isFrom ? "inset 0 0 0 3px var(--accent)" : undefined,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              {isLast && (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "var(--glow)",
                    opacity: 0.22,
                    pointerEvents: "none"
                  }}
                />
              )}
              {isCheckedKing && (
                <motion.span
                  animate={{ opacity: reducedMotion ? 0.4 : [0.25, 0.55, 0.25] }}
                  transition={{ repeat: Infinity, duration: 1.1 }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "radial-gradient(circle, #c0392b 0%, transparent 70%)",
                    pointerEvents: "none"
                  }}
                />
              )}
              {piece && (
                <motion.span
                  layoutId={reducedMotion ? undefined : `piece-${sq}-${piece}`}
                  style={{
                    fontSize: "min(9vw, 46px)",
                    lineHeight: 1,
                    color: piece === piece.toUpperCase() ? "#fbf6ec" : "#20150e",
                    textShadow:
                      piece === piece.toUpperCase()
                        ? "0 1px 2px rgba(0,0,0,.55)"
                        : "0 1px 1px rgba(255,255,255,.25)",
                    userSelect: "none"
                  }}
                >
                  {GLYPH[piece]}
                </motion.span>
              )}
              {isTarget && (
                <span
                  style={{
                    position: "absolute",
                    width: piece ? "82%" : "26%",
                    height: piece ? "82%" : "26%",
                    borderRadius: "50%",
                    background: piece ? "transparent" : "rgba(20,15,10,.35)",
                    border: piece ? "3px solid rgba(20,15,10,.45)" : "none",
                    pointerEvents: "none"
                  }}
                />
              )}
              {/* coordinates, quietly, on the edges */}
              {(flipped ? f === 7 : f === 0) && (
                <span style={{ position: "absolute", top: 2, left: 3, fontSize: 10, opacity: 0.5, color: light ? "#4a3a25" : "#efe3cf" }}>
                  {8 - r}
                </span>
              )}
              {(flipped ? r === 0 : r === 7) && (
                <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: 10, opacity: 0.5, color: light ? "#4a3a25" : "#efe3cf" }}>
                  {"abcdefgh"[f]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Actions view={view} legal={legal} play={play} pending={pending} />

      {promo && (
        <PromotionPicker
          color={view.turn}
          onPick={(p) => {
            sfx("pieceSet");
            play({ kind: "move", from: promo.from, to: promo.to, promo: p });
            setPromo(null);
            setFrom(null);
          }}
          onCancel={() => setPromo(null)}
        />
      )}
    </div>
  );
}

function Clocks({ view, myColor }: { view: ChessView; myColor: Color | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!view.clock.enabled || view.result) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [view.clock.enabled, view.result]);

  if (!view.clock.enabled) return null;
  const now = Date.now();
  const running = view.turn;
  const elapsed = view.clock.lastAt && !view.result ? Math.max(0, now - view.clock.lastAt) : 0;

  const show = (c: Color) => {
    const ms = Math.max(0, view.clock[c] - (c === running ? elapsed : 0));
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const order: Color[] = myColor === "b" ? ["w", "b"] : ["b", "w"];
  return (
    <div style={{ display: "flex", gap: 12, width: "min(92vw, 560px)", maxWidth: "100%", justifyContent: "space-between" }}>
      {order.map((c) => (
        <div
          key={c}
          style={{
            padding: "8px 14px",
            borderRadius: 10,
            border: `1px solid ${running === c ? "var(--accent)" : "var(--line)"}`,
            background: running === c ? "var(--panel)" : "transparent",
            fontVariantNumeric: "tabular-nums",
            fontSize: 20,
            minWidth: 96,
            textAlign: "center"
          }}
        >
          <div style={{ fontSize: 11, color: "var(--mut)", letterSpacing: 2 }}>
            {c === "w" ? "WHITE" : "BLACK"}
          </div>
          {show(c)}
        </div>
      ))}
    </div>
  );
}

function Actions({
  view,
  legal,
  play,
  pending
}: {
  view: ChessView;
  legal: ChessMove[];
  play: (m: ChessMove) => void;
  pending: boolean;
}) {
  const canAccept = legal.some((m) => m.kind === "accept-draw");
  const canResign = legal.some((m) => m.kind === "resign");
  const lastMove = legal.find((m): m is Extract<ChessMove, { kind: "move" }> => m.kind === "move");

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
      {view.drawOffer && canAccept && (
        <>
          <span style={{ fontSize: 13, color: "var(--accent)" }}>Draw offered.</span>
          <button className="gambit-mini" onClick={() => play({ kind: "accept-draw" })}>
            Accept
          </button>
          <button className="gambit-mini" onClick={() => play({ kind: "decline-draw" })}>
            Decline
          </button>
        </>
      )}
      {canResign && lastMove && !view.drawOffer && (
        <button
          className="gambit-mini"
          disabled={pending}
          onClick={() => play({ ...lastMove, offerDraw: true })}
          title="Play your move and offer a draw with it"
        >
          Move &amp; offer draw
        </button>
      )}
      {canResign && (
        <button className="gambit-mini" onClick={() => play({ kind: "resign" })}>
          Resign
        </button>
      )}
      {view.result && <span style={{ fontSize: 14 }}>{view.result.text}</span>}
    </div>
  );
}

function PromotionPicker({
  color,
  onPick,
  onCancel
}: {
  color: Color;
  onPick(p: "q" | "r" | "b" | "n"): void;
  onCancel(): void;
}) {
  const pieces: ("q" | "r" | "b" | "n")[] = ["q", "r", "b", "n"];
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          gap: 8,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 12
        }}
      >
        {pieces.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            aria-label={`Promote to ${p}`}
            style={{
              width: 62,
              height: 62,
              fontSize: 40,
              background: "var(--panel2)",
              border: "1px solid var(--line)",
              borderRadius: 10,
              cursor: "pointer",
              color: "var(--ink)"
            }}
          >
            {GLYPH[color === "w" ? p.toUpperCase() : p]}
          </button>
        ))}
      </div>
    </div>
  );
}
