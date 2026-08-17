"use client";
/**
 * The Hamlet table: the map grows outward from the start tile. Tap a lit square
 * to drop your tile there, rotate with the dial, then choose whether to stand a
 * meeple on what you just laid.
 */
import { motion } from "framer-motion";
import React, { useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import { DELTA, edgeAt, tileById, type EdgeType } from "./tiles";
import type { HamletMove, HamletView } from "./state";

const EDGE_HEX: Record<EdgeType, string> = {
  road: "#c9b58a",
  keep: "#a2624a",
  field: "#6f8d5a"
};
const SEAT_HEX = ["#b0342a", "#2f5f9e", "#3d7a45", "#c9a227", "#6b4f9e"];
const CELL = 56;

export function Board({ view, legal, seat, play, sfx, reducedMotion }: BoardProps<HamletView, HamletMove>) {
  const [rotation, setRotation] = useState(0);
  const [chosen, setChosen] = useState<{ x: number; y: number } | null>(null);

  const placements = useMemo(
    () => legal.filter((m): m is Extract<HamletMove, { kind: "place" }> => m.kind === "place"),
    [legal]
  );
  const discard = legal.find((m) => m.kind === "discard");

  const bounds = useMemo(() => {
    const xs = Object.values(view.tiles).map((t) => t.x);
    const ys = Object.values(view.tiles).map((t) => t.y);
    return {
      minX: Math.min(...xs) - 1,
      maxX: Math.max(...xs) + 1,
      minY: Math.min(...ys) - 1,
      maxY: Math.max(...ys) + 1
    };
  }, [view.tiles]);

  const spotFor = (x: number, y: number) => view.spots.find((s) => s.x === x && s.y === y);
  const meepleOptions = chosen
    ? placements.filter((m) => m.x === chosen.x && m.y === chosen.y && m.rotation === rotation && m.meeple)
    : [];
  const plain = chosen
    ? placements.find((m) => m.x === chosen.x && m.y === chosen.y && m.rotation === rotation && !m.meeple)
    : undefined;

  const width = (bounds.maxX - bounds.minX + 1) * CELL;
  const height = (bounds.maxY - bounds.minY + 1) * CELL;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, width: "min(96vw, 760px)", maxWidth: "100%" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {view.drawn && (
          <>
            <TileFace id={view.drawn} rotation={rotation} size={54} />
            <button
              className="gambit-mini"
              onClick={() => {
                setRotation((r) => (r + 1) % 4);
                sfx("tileSnap");
              }}
            >
              Rotate ⟳
            </button>
          </>
        )}
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{view.bagCount} tiles left</span>
        {discard && (
          <button className="gambit-mini" onClick={() => play(discard)}>
            Nowhere to put it — discard
          </button>
        )}
      </div>

      <div
        style={{
          overflow: "auto",
          background: "var(--felt)",
          borderRadius: 12,
          border: "1px solid var(--line)",
          padding: 8,
          maxHeight: "56vh"
        }}
      >
        <div style={{ position: "relative", width, height }}>
          {/* placed tiles */}
          {Object.values(view.tiles).map((tile) => (
            <div
              key={`${tile.x},${tile.y}`}
              style={{
                position: "absolute",
                left: (tile.x - bounds.minX) * CELL,
                top: (tile.y - bounds.minY) * CELL
              }}
            >
              <TileFace id={tile.id} rotation={tile.rotation} size={CELL - 2} />
            </div>
          ))}

          {/* meeples */}
          {view.meeples.map((m, i) => (
            <motion.div
              key={i}
              initial={reducedMotion ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              title={`${view.names[m.seat]} · ${m.kind}`}
              style={{
                position: "absolute",
                left: (m.x - bounds.minX) * CELL + CELL / 2 - 6,
                top: (m.y - bounds.minY) * CELL + CELL / 2 - 8,
                width: 12,
                height: 16,
                borderRadius: "6px 6px 3px 3px",
                background: SEAT_HEX[m.seat % SEAT_HEX.length],
                border: "1px solid rgba(0,0,0,.5)"
              }}
            />
          ))}

          {/* candidate squares */}
          {view.spots.map((spot) => {
            const active = chosen?.x === spot.x && chosen?.y === spot.y;
            const fits = spot.rotations.includes(rotation);
            return (
              <button
                key={`${spot.x},${spot.y}`}
                onClick={() => {
                  setChosen({ x: spot.x, y: spot.y });
                  if (!fits && spot.rotations[0] !== undefined) setRotation(spot.rotations[0]);
                  sfx("select");
                }}
                aria-label={`Place at ${spot.x}, ${spot.y}`}
                style={{
                  position: "absolute",
                  left: (spot.x - bounds.minX) * CELL,
                  top: (spot.y - bounds.minY) * CELL,
                  width: CELL - 2,
                  height: CELL - 2,
                  borderRadius: 4,
                  border: `2px dashed ${active ? "var(--accent)" : "var(--line)"}`,
                  background: active ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
                  cursor: "pointer"
                }}
              />
            );
          })}
        </div>
      </div>

      {chosen && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {plain || meepleOptions.length ? "Lay it, and claim what you like:" : "Rotate to fit."}
          </span>
          {plain && (
            <button
              className="gambit-mini"
              onClick={() => {
                sfx("tileSnap");
                play(plain);
                setChosen(null);
              }}
            >
              Lay it, no meeple
            </button>
          )}
          {meepleOptions.map((m) => (
            <button
              key={`${m.meeple!.kind}-${m.meeple!.group}`}
              className="gambit-mini"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              onClick={() => {
                sfx("meeple");
                play(m);
                setChosen(null);
              }}
            >
              Claim the {m.meeple!.kind}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
        {Object.keys(view.scores)
          .map(Number)
          .map((s) => (
            <span
              key={s}
              style={{
                padding: "4px 10px",
                borderRadius: 12,
                border: `1px solid ${view.turn === s ? "var(--accent)" : "var(--line)"}`,
                color: SEAT_HEX[s % SEAT_HEX.length]
              }}
            >
              {view.names[s]} · {view.scores[s]}pts · {view.meeplesLeft[s]} meeples
            </span>
          ))}
      </div>
    </div>
  );
}

function TileFace({ id, rotation, size }: { id: string; rotation: number; size: number }) {
  const tile = tileById(id);
  const half = size / 2;
  const edge = (side: number) => edgeAt(tile, rotation, side);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: 4 }}>
      <rect width={size} height={size} fill={EDGE_HEX.field} />
      {[0, 1, 2, 3].map((side) => {
        const type = edge(side);
        if (type === "field") return null;
        const [dx, dy] = DELTA[side]!;
        return (
          <line
            key={side}
            x1={half}
            y1={half}
            x2={half + dx * half}
            y2={half + dy * half}
            stroke={EDGE_HEX[type]}
            strokeWidth={type === "keep" ? size * 0.3 : size * 0.14}
            strokeLinecap="butt"
          />
        );
      })}
      {tile.keeps.length > 0 && <circle cx={half} cy={half} r={size * 0.16} fill={EDGE_HEX.keep} />}
      {tile.shrine && <circle cx={half} cy={half} r={size * 0.13} fill="#e0c56a" stroke="#3a3632" />}
      {tile.banner && <rect x={half - 4} y={4} width={8} height={8} fill="#e0c56a" stroke="#3a3632" />}
      <rect width={size} height={size} fill="none" stroke="rgba(0,0,0,.35)" />
    </svg>
  );
}
