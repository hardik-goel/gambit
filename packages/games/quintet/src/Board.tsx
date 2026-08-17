"use client";
/**
 * The Quintet table: a ten-by-ten grid of card faces, a hand tray along the
 * bottom, and chips that land with a clack. Tap a card, its open squares light;
 * tap a square, the chip is already there.
 */
import { motion } from "framer-motion";
import React, { useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import { CORNERS, SIZE, isOneEyed, isTwoEyed, type Card } from "./layout";
import { TEAM_HUES, TEAM_NAMES, type QuintetMove, type QuintetView } from "./state";

const SUIT_GLYPH: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const isRed = (card: Card) => card.endsWith("H") || card.endsWith("D");

export function Board({ view, legal, play, sfx, reducedMotion }: BoardProps<QuintetView, QuintetMove>) {
  const [picked, setPicked] = useState<Card | null>(null);

  const byCard = useMemo(() => {
    const map = new Map<Card, QuintetMove[]>();
    for (const m of legal) {
      if (m.kind === "pass") continue;
      const list = map.get(m.card) ?? [];
      list.push(m);
      map.set(m.card, list);
    }
    return map;
  }, [legal]);

  const activeMoves = picked ? (byCard.get(picked) ?? []) : [];
  const targets = new Map<number, QuintetMove>();
  for (const m of activeMoves) {
    if (m.kind === "play" || m.kind === "remove") targets.set(m.cell, m);
  }
  const canExchange = activeMoves.some((m) => m.kind === "exchange");
  const mustPass = legal.length === 1 && legal[0]!.kind === "pass";

  return (
    <div style={{ display: "grid", gap: 14, justifyItems: "center", width: "100%" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {Array.from({ length: view.teamCount }, (_, t) => {
          const got = view.sequences.filter((s) => s.team === t).length;
          return (
            <div
              key={t}
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 12,
                border: `1px solid ${TEAM_HUES[t]}`,
                color: TEAM_HUES[t]
              }}
            >
              {TEAM_NAMES[t]} · {got}/{view.target}
            </div>
          );
        })}
      </div>

      <div
        role="grid"
        aria-label="Quintet board"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${SIZE}, 1fr)`,
          gap: 2,
          width: "min(94vw, 580px)", maxWidth: "100%",
          aspectRatio: "1",
          padding: 6,
          borderRadius: 12,
          background: "var(--panel2)",
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)"
        }}
      >
        {view.board.map((card, cell) => {
          const chip = view.chips[cell];
          const isCorner = CORNERS.includes(cell);
          const move = targets.get(cell);
          const locked = view.locked[cell];

          return (
            <button
              key={cell}
              role="gridcell"
              aria-label={
                isCorner
                  ? "wild corner"
                  : `${card}${chip !== null && chip !== undefined ? `, ${TEAM_NAMES[chip]} chip` : ", open"}`
              }
              onClick={() => {
                if (!move) return;
                sfx("chipClack");
                play(move);
                setPicked(null);
              }}
              style={{
                position: "relative",
                aspectRatio: "1",
                borderRadius: 4,
                border: move ? "2px solid var(--accent)" : "1px solid var(--line)",
                background: isCorner ? "var(--backing)" : "var(--panel)",
                color: isCorner ? "var(--accent)" : isRed(card ?? "") ? "#b1503f" : "var(--ink)",
                fontSize: "clamp(7px, 1.5vw, 11px)",
                lineHeight: 1.05,
                cursor: move ? "pointer" : "default",
                padding: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden"
              }}
            >
              {isCorner ? (
                <span style={{ fontSize: "clamp(9px, 2vw, 15px)" }}>★</span>
              ) : (
                <>
                  <span>{card?.slice(0, -1)}</span>
                  <span>{SUIT_GLYPH[card?.slice(-1) ?? "S"]}</span>
                </>
              )}

              {chip !== null && chip !== undefined && (
                <motion.span
                  initial={reducedMotion ? false : { scale: 0.2, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 520, damping: 22 }}
                  style={{
                    position: "absolute",
                    inset: "14%",
                    borderRadius: "50%",
                    background: chip === -1 ? "var(--accent)" : TEAM_HUES[chip],
                    boxShadow: locked
                      ? "0 0 0 2px var(--ink), inset 0 -2px 4px rgba(0,0,0,.4)"
                      : "inset 0 -2px 4px rgba(0,0,0,.4)",
                    opacity: chip === -1 ? 0.55 : 1
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* hand tray */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "center",
          padding: "10px 6px",
          width: "100%"
        }}
      >
        {view.hand.map((card, i) => {
          const playable = byCard.has(card);
          const dead = view.dead.includes(card);
          const on = picked === card;
          return (
            <motion.button
              key={`${card}-${i}`}
              layout
              animate={{ y: on ? -10 : 0 }}
              onClick={() => {
                setPicked(on ? null : card);
                sfx("cardSlip");
              }}
              aria-pressed={on}
              aria-label={`${card}${dead ? ", dead" : ""}`}
              style={{
                width: 52,
                height: 74,
                borderRadius: 7,
                border: `1px solid ${on ? "var(--accent)" : "var(--line)"}`,
                background: dead ? "var(--panel2)" : "var(--panel)",
                color: isRed(card) ? "#b1503f" : "var(--ink)",
                opacity: playable || dead ? 1 : 0.45,
                cursor: "pointer",
                fontSize: 16,
                display: "grid",
                placeItems: "center",
                boxShadow: on ? "var(--shadow)" : "var(--shadow-sm)"
              }}
            >
              <div>{card.slice(0, -1)}</div>
              <div style={{ fontSize: 18 }}>{SUIT_GLYPH[card.slice(-1)]}</div>
              {isTwoEyed(card) && <div style={{ fontSize: 9, color: "var(--accent)" }}>WILD</div>}
              {isOneEyed(card) && <div style={{ fontSize: 9, color: "var(--mut)" }}>LIFT</div>}
            </motion.button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, fontSize: 13, color: "var(--mut)", alignItems: "center" }}>
        <span>{view.deckCount} cards left</span>
        {canExchange && picked && (
          <button
            className="gambit-mini"
            onClick={() => {
              play({ kind: "exchange", card: picked });
              setPicked(null);
            }}
          >
            Swap this dead card
          </button>
        )}
        {mustPass && (
          <button className="gambit-mini" onClick={() => play({ kind: "pass" })}>
            Nothing to play — pass
          </button>
        )}
      </div>
    </div>
  );
}
