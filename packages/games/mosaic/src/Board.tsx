"use client";
/**
 * The Mosaic table: factory displays around the middle, your board below,
 * everyone else's boards folded down beside it. Pick a colour, then a row.
 */
import { motion } from "framer-motion";
import React, { useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import {
  COLOURS,
  COLOUR_HEX,
  FLOOR_PENALTIES,
  ROWS,
  WALL,
  wallColumnFor,
  type Colour,
  type MosaicMove,
  type MosaicView,
  type PlayerBoard
} from "./state";

function Tile({ colour, size = 22, ghost }: { colour: number; size?: number; ghost?: boolean }) {
  const isToken = colour < 0;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        display: "inline-grid",
        placeItems: "center",
        background: isToken ? "var(--panel2)" : COLOUR_HEX[colour],
        border: isToken ? "1px solid var(--accent)" : "1px solid rgba(0,0,0,.28)",
        color: "var(--accent)",
        fontSize: size * 0.55,
        opacity: ghost ? 0.28 : 1,
        boxShadow: ghost ? "none" : "inset 0 -2px 3px rgba(0,0,0,.25)"
      }}
    >
      {isToken ? "1" : ""}
    </span>
  );
}

export function Board({ view, legal, seat, play, sfx, reducedMotion }: BoardProps<MosaicView, MosaicMove>) {
  const [pick, setPick] = useState<{ source: number; colour: Colour } | null>(null);
  const mySeat = seat ?? view.turn;
  const board = view.boards[mySeat];

  const rowsFor = useMemo(() => {
    if (!pick) return new Set<number>();
    return new Set(
      legal.filter((m) => m.source === pick.source && m.colour === pick.colour).map((m) => m.row)
    );
  }, [legal, pick]);

  const takeable = useMemo(() => {
    const set = new Set<string>();
    for (const m of legal) set.add(`${m.source}:${m.colour}`);
    return set;
  }, [legal]);

  function commit(row: number) {
    if (!pick) return;
    sfx("tileSnap");
    play({ kind: "take", source: pick.source, colour: pick.colour, row });
    setPick(null);
  }

  return (
    <div style={{ display: "grid", gap: 16, width: "min(96vw, 720px)" }}>
      {/* factories + centre */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {view.factories.map((factory, i) => (
          <div
            key={i}
            style={{
              width: 78,
              height: 78,
              borderRadius: "50%",
              border: "1px solid var(--line)",
              background: "var(--panel)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 4,
              placeContent: "center",
              padding: 8,
              opacity: factory.length ? 1 : 0.3
            }}
          >
            {factory.map((colour, j) => (
              <button
                key={j}
                onClick={() => {
                  if (!takeable.has(`${i}:${colour}`)) return;
                  setPick({ source: i, colour });
                  sfx("select");
                }}
                aria-label={`${COLOURS[colour]} tile in factory ${i + 1}`}
                style={{
                  border:
                    pick?.source === i && pick.colour === colour
                      ? "2px solid var(--accent)"
                      : "1px solid transparent",
                  background: "transparent",
                  padding: 0,
                  borderRadius: 6,
                  cursor: takeable.has(`${i}:${colour}`) ? "pointer" : "default"
                }}
              >
                <Tile colour={colour} />
              </button>
            ))}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          justifyContent: "center",
          minHeight: 34,
          padding: 8,
          borderRadius: 12,
          background: "var(--panel2)",
          border: "1px dashed var(--line)"
        }}
      >
        {view.tokenInCentre && <Tile colour={-1} />}
        {view.centre.map((colour, i) => (
          <button
            key={i}
            onClick={() => {
              if (!takeable.has(`-1:${colour}`)) return;
              setPick({ source: -1, colour });
              sfx("select");
            }}
            style={{
              border: pick?.source === -1 && pick.colour === colour ? "2px solid var(--accent)" : "none",
              background: "transparent",
              padding: 0,
              borderRadius: 6,
              cursor: "pointer"
            }}
            aria-label={`${COLOURS[colour]} tile in the middle`}
          >
            <Tile colour={colour} />
          </button>
        ))}
        {view.centre.length === 0 && !view.tokenInCentre && (
          <span style={{ color: "var(--mut)", fontSize: 12 }}>the middle is clear</span>
        )}
      </div>

      {board && (
        <PlayerPanel
          board={board}
          name={view.names[mySeat] ?? "You"}
          active={view.turn === mySeat}
          highlightRows={rowsFor}
          onRow={commit}
          reducedMotion={reducedMotion}
        />
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        {Object.keys(view.boards)
          .map(Number)
          .filter((s) => s !== mySeat)
          .map((s) => (
            <PlayerPanel
              key={s}
              board={view.boards[s]!}
              name={view.names[s] ?? `Seat ${s + 1}`}
              active={view.turn === s}
              compact
              reducedMotion={reducedMotion}
            />
          ))}
      </div>

      <div style={{ textAlign: "center", fontSize: 12, color: "var(--mut)" }}>
        round {view.round} · {view.bagCount} tiles in the bag
        {pick && " · now choose a row"}
      </div>
    </div>
  );
}

function PlayerPanel({
  board,
  name,
  active,
  compact,
  highlightRows,
  onRow,
  reducedMotion
}: {
  board: PlayerBoard;
  name: string;
  active: boolean;
  compact?: boolean;
  highlightRows?: Set<number>;
  onRow?(row: number): void;
  reducedMotion?: boolean;
}) {
  const size = compact ? 12 : 22;
  return (
    <div
      className={active ? "gambit-turn" : undefined}
      style={{
        padding: compact ? 10 : 14,
        borderRadius: 12,
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        background: "var(--panel)",
        display: "grid",
        gap: 8
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: compact ? 12 : 14 }}>
        <span>{name}</span>
        <span style={{ color: "var(--accent)" }}>{board.score}</span>
      </div>

      <div style={{ display: "flex", gap: compact ? 8 : 14, alignItems: "flex-start" }}>
        {/* staging rows */}
        <div style={{ display: "grid", gap: 3 }}>
          {Array.from({ length: ROWS }, (_, row) => {
            const line = board.rows[row]!;
            const lit = highlightRows?.has(row);
            return (
              <button
                key={row}
                disabled={!onRow || !lit}
                onClick={() => onRow?.(row)}
                aria-label={`Pattern row ${row + 1}`}
                style={{
                  display: "flex",
                  gap: 3,
                  justifyContent: "flex-end",
                  padding: 2,
                  borderRadius: 5,
                  border: lit ? "2px solid var(--accent)" : "1px solid transparent",
                  background: "transparent",
                  cursor: lit ? "pointer" : "default"
                }}
              >
                {Array.from({ length: row + 1 }, (_, i) => {
                  const filled = i >= row + 1 - line.count;
                  return filled && line.colour !== null ? (
                    <motion.span
                      key={i}
                      initial={reducedMotion ? false : { scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                    >
                      <Tile colour={line.colour} size={size} />
                    </motion.span>
                  ) : (
                    <span
                      key={i}
                      style={{
                        width: size,
                        height: size,
                        borderRadius: 4,
                        border: "1px dashed var(--line)"
                      }}
                    />
                  );
                })}
              </button>
            );
          })}
        </div>

        {/* the wall */}
        <div style={{ display: "grid", gridTemplateRows: `repeat(${WALL}, auto)`, gap: 3 }}>
          {Array.from({ length: WALL }, (_, row) => (
            <div key={row} style={{ display: "flex", gap: 3 }}>
              {Array.from({ length: WALL }, (_, col) => {
                const colour = ((col - row + WALL) % WALL) as Colour;
                const done = board.wall[row]![col];
                return <Tile key={col} colour={colour} size={size} ghost={!done} />;
              })}
            </div>
          ))}
        </div>
      </div>

      {/* floor */}
      <div
        style={{
          display: "flex",
          gap: 3,
          alignItems: "center",
          borderTop: "1px solid var(--line)",
          paddingTop: 6
        }}
      >
        {FLOOR_PENALTIES.map((penalty, i) => {
          const tile = board.floor[i];
          return (
            <div key={i} style={{ display: "grid", justifyItems: "center", gap: 1 }}>
              {tile === undefined ? (
                <span
                  style={{
                    width: size * 0.8,
                    height: size * 0.8,
                    borderRadius: 3,
                    border: "1px dashed var(--line)"
                  }}
                />
              ) : (
                <Tile colour={tile} size={size * 0.8} />
              )}
              <span style={{ fontSize: 8, color: "var(--mut)" }}>{penalty}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
