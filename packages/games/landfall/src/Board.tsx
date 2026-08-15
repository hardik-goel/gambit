"use client";
/**
 * The Landfall table: the island in SVG, your hand along the bottom, and the
 * trade tray in the middle when there's an offer on it.
 */
import { motion } from "framer-motion";
import React, { useMemo } from "react";
import type { BoardProps } from "@gambit/sdk";
import { EDGES, HEXES, RESOURCES, RESOURCE_HEX, VERTICES, type Resource } from "./island";
import type { LandfallMove, LandfallView } from "./state";

const SEAT_HEX = ["#b0342a", "#2f5f9e", "#3d7a45", "#c9a227"];
const SCALE = 46;
const OX = 300;
const OY = 300;
const px = (x: number, y: number): [number, number] => [OX + x * SCALE, OY + y * SCALE];

export function Board({ view, legal, seat, play, sfx, reducedMotion }: BoardProps<LandfallView, LandfallMove>) {
  const mySeat = seat ?? view.turn;

  const byVertex = useMemo(() => {
    const map = new Map<number, LandfallMove>();
    for (const m of legal) {
      if (m.kind === "place-settlement" || m.kind === "build-settlement") map.set(m.vertex, m);
      if (m.kind === "build-city" && !map.has(m.vertex)) map.set(m.vertex, m);
    }
    return map;
  }, [legal]);

  const byEdge = useMemo(() => {
    const map = new Map<number, LandfallMove>();
    for (const m of legal) {
      if (m.kind === "place-road" || m.kind === "build-road") map.set(m.edge, m);
    }
    return map;
  }, [legal]);

  const robberMoves = legal.filter(
    (m): m is Extract<LandfallMove, { kind: "move-robber" }> => m.kind === "move-robber"
  );
  const roll = legal.find((m) => m.kind === "roll");
  const endTurn = legal.find((m) => m.kind === "end-turn");
  const buyDev = legal.find((m) => m.kind === "buy-dev");
  const discards = legal.filter((m): m is Extract<LandfallMove, { kind: "discard" }> => m.kind === "discard");
  const responses = legal.filter((m): m is Extract<LandfallMove, { kind: "respond" }> => m.kind === "respond");
  const closes = legal.filter((m): m is Extract<LandfallMove, { kind: "close-offer" }> => m.kind === "close-offer");
  const bankTrades = legal.filter((m): m is Extract<LandfallMove, { kind: "bank-trade" }> => m.kind === "bank-trade");
  const offers = legal.filter((m): m is Extract<LandfallMove, { kind: "offer" }> => m.kind === "offer");

  return (
    <div style={{ display: "grid", gap: 12, width: "min(96vw, 720px)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span style={{ color: "var(--accent)" }}>{view.phase}</span>
        {view.lastRoll && (
          <span>
            rolled {view.lastRoll[0]} + {view.lastRoll[1]} = {view.lastRoll[0] + view.lastRoll[1]}
          </span>
        )}
        {roll && (
          <button
            className="gambit-mini"
            onClick={() => {
              sfx("diceTumble");
              play(roll);
            }}
          >
            Roll
          </button>
        )}
        {buyDev && (
          <button className="gambit-mini" onClick={() => play(buyDev)}>
            Buy a development card
          </button>
        )}
        {endTurn && (
          <button className="gambit-mini" onClick={() => play(endTurn)}>
            End turn
          </button>
        )}
        {robberMoves.length > 0 && <span style={{ color: "var(--accent)" }}>place the robber</span>}
      </div>

      {view.pending?.kind === "discard" && discards.length > 0 && (
        <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--accent)", background: "var(--panel)" }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>{view.pending.prompt}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {discards.map((m, i) => (
              <button key={i} className="gambit-mini" onClick={() => play(m)}>
                {RESOURCES.filter((r) => m.give[r]).map((r) => `${m.give[r]} ${r}`).join(", ")}
              </button>
            ))}
          </div>
        </div>
      )}

      {view.offer && (
        <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--accent)", background: "var(--panel)" }}>
          <div style={{ fontSize: 14 }}>
            {view.names[view.offer.from]} offers{" "}
            {RESOURCES.filter((r) => view.offer!.give[r]).map((r) => `${view.offer!.give[r]} ${r}`).join(", ")} for{" "}
            {RESOURCES.filter((r) => view.offer!.want[r]).map((r) => `${view.offer!.want[r]} ${r}`).join(", ")}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {responses.map((m) => (
              <button key={String(m.accept)} className="gambit-mini" onClick={() => play(m)}>
                {m.accept ? "I'll take that" : "No thanks"}
              </button>
            ))}
            {closes.map((m) => (
              <button key={String(m.with)} className="gambit-mini" onClick={() => play(m)}>
                {m.with === null ? "Withdraw" : `Deal with ${view.names[m.with]}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <svg
        viewBox="0 0 600 600"
        style={{
          width: "100%",
          background: "var(--felt)",
          borderRadius: 12,
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)"
        }}
        role="img"
        aria-label="Landfall island"
      >
        {HEXES.map((hex) => {
          const [cx, cy] = px(hex.x, hex.y);
          const points = hex.corners
            .map((id) => {
              const v = VERTICES[id]!;
              const [x, y] = px(v.x, v.y);
              return `${x},${y}`;
            })
            .join(" ");
          const terrain = view.terrain[hex.id]!;
          const number = view.numbers[hex.id];
          return (
            <g key={hex.id}>
              <polygon points={points} fill={RESOURCE_HEX[terrain]} stroke="rgba(0,0,0,.35)" strokeWidth={1.5} />
              {number !== null && number !== undefined && (
                <>
                  <circle cx={cx} cy={cy} r={13} fill="#efe7d3" opacity={0.9} />
                  <text
                    x={cx}
                    y={cy + 5}
                    fontSize={14}
                    fontWeight={700}
                    textAnchor="middle"
                    fill={number === 6 || number === 8 ? "#b0342a" : "#2b2116"}
                  >
                    {number}
                  </text>
                </>
              )}
              {view.robber === hex.id && (
                <circle cx={cx} cy={cy - 20} r={8} fill="#2b2116" stroke="#efe7d3" strokeWidth={1.5} />
              )}
              {robberMoves.some((m) => m.hex === hex.id) && (
                <polygon
                  points={points}
                  fill="var(--accent)"
                  opacity={0.25}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    const options = robberMoves.filter((m) => m.hex === hex.id);
                    const withSteal = options.find((m) => m.steal !== null) ?? options[0]!;
                    sfx("swoosh");
                    play(withSteal);
                  }}
                />
              )}
            </g>
          );
        })}

        {EDGES.map((edge) => {
          const a = VERTICES[edge.a]!;
          const b = VERTICES[edge.b]!;
          const [x1, y1] = px(a.x, a.y);
          const [x2, y2] = px(b.x, b.y);
          const owner = view.roads[edge.id];
          const move = byEdge.get(edge.id);
          return (
            <line
              key={edge.id}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={
                owner !== undefined
                  ? SEAT_HEX[owner % SEAT_HEX.length]
                  : move
                    ? "var(--accent)"
                    : "transparent"
              }
              strokeWidth={owner !== undefined ? 6 : 5}
              strokeLinecap="round"
              opacity={owner !== undefined ? 1 : move ? 0.45 : 0}
              style={{ cursor: move ? "pointer" : "default" }}
              onClick={() => {
                if (!move) return;
                sfx("pieceSet");
                play(move);
              }}
            />
          );
        })}

        {VERTICES.map((v) => {
          const [x, y] = px(v.x, v.y);
          const building = view.buildings[v.id];
          const move = byVertex.get(v.id);
          if (!building && !move && !v.port) return null;
          return (
            <g key={v.id} onClick={() => move && play(move)} style={{ cursor: move ? "pointer" : "default" }}>
              {v.port && !building && (
                <circle cx={x} cy={y} r={4} fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.8} />
              )}
              {move && <circle cx={x} cy={y} r={8} fill="var(--accent)" opacity={0.4} />}
              {building && (
                <motion.rect
                  initial={reducedMotion ? false : { scale: 0.3 }}
                  animate={{ scale: 1 }}
                  x={x - 7}
                  y={y - 7}
                  width={14}
                  height={14}
                  rx={building.type === "city" ? 2 : 7}
                  fill={SEAT_HEX[building.seat % SEAT_HEX.length]}
                  stroke="rgba(0,0,0,.5)"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* hand */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {RESOURCES.map((r) => (
          <span
            key={r}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              background: RESOURCE_HEX[r],
              color: "#f6efe2",
              fontSize: 13
            }}
          >
            {r} × {view.hand[r]}
          </span>
        ))}
        <span style={{ fontSize: 12, color: "var(--mut)" }}>
          {view.devs.filter((d) => !d.played).length} cards in hand
        </span>
      </div>

      {(bankTrades.length > 0 || offers.length > 0) && (
        <details>
          <summary style={{ fontSize: 13, color: "var(--mut)", cursor: "pointer" }}>Trade</summary>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {bankTrades.slice(0, 12).map((m, i) => (
              <button key={`b${i}`} className="gambit-mini" onClick={() => play(m)}>
                {view.rates[m.give]} {m.give} → {m.get}
              </button>
            ))}
            {offers.slice(0, 10).map((m, i) => (
              <button key={`o${i}`} className="gambit-mini" onClick={() => play(m)}>
                offer {Object.keys(m.give)[0]} for {Object.keys(m.want)[0]}
              </button>
            ))}
          </div>
        </details>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
        {Object.keys(view.names)
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
              {view.names[s]} · {view.points[s]}pts · {view.handCounts[s]} cards
              {view.longestRoad?.seat === s ? " · road" : ""}
              {view.largestArmy?.seat === s ? " · army" : ""}
            </span>
          ))}
        {mySeat !== null && <span style={{ color: "var(--mut)" }}>bank rates {view.rates.wood}:1</span>}
      </div>
    </div>
  );
}

export type { Resource };
