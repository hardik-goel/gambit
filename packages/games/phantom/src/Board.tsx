"use client";
/**
 * The Phantom table.
 *
 * Detectives see the city, each other, the ticket log and the five sightings —
 * and a shaded "could be here" cloud they can turn on, because that is the
 * deduction the game is actually about. The fugitive sees everything, including
 * themselves.
 */
import { motion } from "framer-motion";
import React, { useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import { CITY, exitsFrom } from "./city";
import { consistentSet } from "./bot";
import type { PhantomMove, PhantomView } from "./state";

const LAYER_HEX: Record<string, string> = {
  cab: "#8a8474",
  tram: "#3c6ea8",
  metro: "#a6592e",
  river: "#2f7f8f",
  black: "#1b1b1b"
};
const SEAT_HEX = ["#b0342a", "#2f5f9e", "#3d7a45", "#c9a227", "#6b4f9e", "#2e2a26"];

export function Board({ view, legal, seat, play, sfx }: BoardProps<PhantomView, PhantomMove>) {
  const [showCloud, setShowCloud] = useState(true);
  const [from, setFrom] = useState<number | null>(null);

  const mySeat = seat ?? view.toMove;
  const myNode = view.positions[mySeat] ?? null;
  const moves = useMemo(
    () => legal.filter((m): m is Extract<PhantomMove, { kind: "move" }> => m.kind === "move"),
    [legal]
  );
  const stuck = legal.find((m) => m.kind === "stuck");

  const cloud = useMemo(() => {
    if (view.amFugitive || !showCloud) return new Set<number>();
    const detectives = Object.entries(view.positions)
      .filter(([s]) => Number(s) !== view.fugitiveSeat)
      .map(([, n]) => n)
      .filter((n): n is number => typeof n === "number");
    return consistentSet(view, detectives);
  }, [view, showCloud]);

  const targets = useMemo(() => {
    const map = new Map<number, Extract<PhantomMove, { kind: "move" }>[]>();
    for (const m of moves) map.set(m.to, [...(map.get(m.to) ?? []), m]);
    return map;
  }, [moves]);

  const seatAt = (node: number): number | null => {
    for (const [s, n] of Object.entries(view.positions)) {
      if (n === node && Number(s) !== view.fugitiveSeat) return Number(s);
    }
    if (view.positions[view.fugitiveSeat ?? -1] === node) return view.fugitiveSeat;
    return null;
  };

  return (
    <div style={{ display: "grid", gap: 12, width: "min(97vw, 960px)", maxWidth: "100%" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span style={{ color: "var(--accent)" }}>
          round {view.round} of {view.finalRound}
        </span>
        <span>{view.amFugitive ? "you are the fugitive" : "you are a detective"}</span>
        {!view.amFugitive && (
          <button className="gambit-mini" onClick={() => setShowCloud((s) => !s)}>
            {showCloud ? "Hide" : "Show"} where they could be
            {cloud.size > 0 && ` (${cloud.size})`}
          </button>
        )}
        {view.lastSighting && (
          <span style={{ color: "var(--mut)" }}>
            last seen at {view.lastSighting.node} in round {view.lastSighting.round}
          </span>
        )}
        {stuck && (
          <button className="gambit-mini" onClick={() => play(stuck)}>
            No ticket goes anywhere — stay put
          </button>
        )}
      </div>

      <svg
        viewBox="0 0 980 800"
        style={{
          width: "100%",
          background: "var(--felt)",
          borderRadius: 12,
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)"
        }}
        role="img"
        aria-label="Phantom city map"
      >
        {CITY.cab.map(([a, b], i) => (
          <Line key={`c${i}`} a={a} b={b} colour={LAYER_HEX.cab!} width={1} opacity={0.35} />
        ))}
        {CITY.tram.map(([a, b], i) => (
          <Line key={`t${i}`} a={a} b={b} colour={LAYER_HEX.tram!} width={2.4} opacity={0.65} />
        ))}
        {CITY.metro.map(([a, b], i) => (
          <Line key={`m${i}`} a={a} b={b} colour={LAYER_HEX.metro!} width={3.4} opacity={0.75} />
        ))}
        {CITY.river.map(([a, b], i) => (
          <Line key={`r${i}`} a={a} b={b} colour={LAYER_HEX.river!} width={4} opacity={0.7} dashed />
        ))}

        {CITY.nodes.map((node) => {
          const options = targets.get(node.id);
          const occupant = seatAt(node.id);
          const inCloud = cloud.has(node.id);
          const isMe = myNode === node.id;
          return (
            <g
              key={node.id}
              onClick={() => {
                if (!options?.length) {
                  setFrom(null);
                  return;
                }
                if (options.length === 1) {
                  sfx("pieceSet");
                  play(options[0]!);
                  return;
                }
                setFrom(node.id);
                sfx("select");
              }}
              style={{ cursor: options?.length ? "pointer" : "default" }}
            >
              {inCloud && (
                <circle cx={node.x} cy={node.y} r={13} fill="var(--accent)" opacity={0.18} />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.metro ? 8 : node.tram ? 6.5 : 5}
                fill={
                  occupant !== null && occupant !== undefined
                    ? occupant === view.fugitiveSeat
                      ? "#1b1b1b"
                      : SEAT_HEX[occupant % SEAT_HEX.length]!
                    : "var(--panel)"
                }
                stroke={options?.length ? "var(--accent)" : isMe ? "var(--ink)" : "rgba(0,0,0,.45)"}
                strokeWidth={options?.length ? 2.5 : 1}
              />
              <text
                x={node.x}
                y={node.y - 11}
                fontSize={8}
                fill="var(--mut)"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {node.id}
              </text>
            </g>
          );
        })}
      </svg>

      {from && (targets.get(from)?.length ?? 0) > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>Travel to {from} by:</span>
          {targets.get(from)!.map((m, i) => (
            <button
              key={i}
              className="gambit-mini"
              style={{ borderColor: LAYER_HEX[m.transport] }}
              onClick={() => {
                sfx("pieceSet");
                play(m);
                setFrom(null);
              }}
            >
              {m.transport}
              {m.double ? " + double" : ""}
            </button>
          ))}
        </div>
      )}

      {/* the log — the detectives' entire evidence base */}
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: "var(--mut)" }}>THE TRAIL</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {view.log.map((entry, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              title={`Round ${entry.round}`}
              style={{
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 11,
                background: entry.node !== null ? "var(--accent)" : "var(--panel2)",
                color: entry.node !== null ? "var(--bg)" : "var(--ink)",
                border: `1px solid ${LAYER_HEX[entry.transport] ?? "var(--line)"}`
              }}
            >
              {entry.round}. {entry.transport}
              {entry.node !== null ? ` → ${entry.node}` : ""}
              {entry.double ? " ⇄" : ""}
            </motion.span>
          ))}
          {view.log.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>nothing yet — they haven't moved</span>
          )}
        </div>
      </div>

      {/* tickets */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
        {Object.keys(view.tickets)
          .map(Number)
          .map((s) => {
            const t = view.tickets[s]!;
            const fugitive = s === view.fugitiveSeat;
            return (
              <span
                key={s}
                style={{
                  padding: "4px 10px",
                  borderRadius: 12,
                  border: `1px solid ${view.toMove === s ? "var(--accent)" : "var(--line)"}`,
                  color: fugitive ? "var(--ink)" : SEAT_HEX[s % SEAT_HEX.length]
                }}
              >
                {view.names[s]}
                {fugitive
                  ? ` · ${t.black} black · ${t.double} double`
                  : ` · ${t.cab} cab · ${t.tram} tram · ${t.metro} metro`}
              </span>
            );
          })}
      </div>
    </div>
  );
}

function Line({
  a,
  b,
  colour,
  width,
  opacity,
  dashed
}: {
  a: number;
  b: number;
  colour: string;
  width: number;
  opacity: number;
  dashed?: boolean;
}) {
  const from = CITY.nodes[a - 1]!;
  const to = CITY.nodes[b - 1]!;
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={colour}
      strokeWidth={width}
      opacity={opacity}
      strokeDasharray={dashed ? "6 4" : undefined}
    />
  );
}
