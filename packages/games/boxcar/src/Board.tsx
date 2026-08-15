"use client";
/**
 * The Boxcar table: the map as an SVG, the market above your hand, your tickets
 * in a tray you can fold away. Claimable routes brighten when your hand can pay
 * for them, which is the whole game in one visual affordance.
 */
import { motion } from "framer-motion";
import React, { useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import { COLOUR_HEX, MAPS, routePoints, type Card } from "./maps";
import type { BoxcarMove, BoxcarView, Hand } from "./state";

const SEAT_HEX = ["#b0342a", "#2f5f9e", "#3d7a45", "#c9a227", "#2e2a26"];

export function Board({ view, legal, seat, play, sfx }: BoardProps<BoxcarView, BoxcarMove>) {
  const map = MAPS[view.mapId]!;
  const [showTickets, setShowTickets] = useState(true);
  const [keep, setKeep] = useState<number[]>([]);

  const claimsByRoute = useMemo(() => {
    const byRoute = new Map<number, Extract<BoxcarMove, { kind: "claim" }>[]>();
    for (const m of legal) {
      if (m.kind !== "claim") continue;
      byRoute.set(m.route, [...(byRoute.get(m.route) ?? []), m]);
    }
    return byRoute;
  }, [legal]);

  const draws = legal.filter((m): m is Extract<BoxcarMove, { kind: "draw" }> => m.kind === "draw");
  const stations = legal.filter((m): m is Extract<BoxcarMove, { kind: "station" }> => m.kind === "station");
  const ticketDraw = legal.find((m) => m.kind === "tickets");
  const keeps = legal.filter((m): m is Extract<BoxcarMove, { kind: "keep" }> => m.kind === "keep");
  const tunnelPay = legal.find((m) => m.kind === "tunnel-pay");
  const tunnelOut = legal.find((m) => m.kind === "tunnel-withdraw");

  const bounds = useMemo(() => {
    const xs = map.cities.map((c) => c.x);
    const ys = map.cities.map((c) => c.y);
    const pad = 40;
    return {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      w: Math.max(...xs) - Math.min(...xs) + pad * 2,
      h: Math.max(...ys) - Math.min(...ys) + pad * 2
    };
  }, [map]);

  const cityAt = (key: string) => map.cities.find((c) => c.key === key)!;
  const stationOwner = (key: string) =>
    Object.entries(view.stationCities).find(([, cities]) => cities.includes(key))?.[0];

  return (
    <div style={{ display: "grid", gap: 12, width: "min(97vw, 900px)" }}>
      {view.pending && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--panel)",
            border: "1px solid var(--accent)",
            fontSize: 14
          }}
        >
          <div>{view.pending.prompt}</div>
          {view.tunnel && (
            <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
              <span>Revealed: {view.tunnel.revealed.join(", ")}</span>
              {tunnelPay && (
                <button className="gambit-mini" onClick={() => play(tunnelPay)}>
                  Pay {view.tunnel.extra} more
                </button>
              )}
              {tunnelOut && (
                <button className="gambit-mini" onClick={() => play(tunnelOut)}>
                  Take it back
                </button>
              )}
            </div>
          )}
          {keeps.length > 0 && (
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {view.offered.map((t) => {
                const on = keep.includes(t.id);
                return (
                  <button
                    key={t.id}
                    className="gambit-mini"
                    style={{
                      textAlign: "left",
                      borderColor: on ? "var(--accent)" : "var(--line)",
                      color: on ? "var(--accent)" : "var(--ink)"
                    }}
                    onClick={() => setKeep(on ? keep.filter((k) => k !== t.id) : [...keep, t.id])}
                  >
                    {cityAt(t.a).name} → {cityAt(t.b).name} · {t.points}
                    {t.long ? " · long" : ""}
                  </button>
                );
              })}
              <button
                className="gambit-mini"
                disabled={!keeps.some((k) => sameSet(k.ids, keep))}
                onClick={() => {
                  const move = keeps.find((k) => sameSet(k.ids, keep));
                  if (move) {
                    sfx("cardSlip");
                    play(move);
                    setKeep([]);
                  }
                }}
              >
                Keep {keep.length}
              </button>
            </div>
          )}
        </div>
      )}

      {/* the map */}
      <svg
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
        style={{
          width: "100%",
          background: "var(--felt)",
          borderRadius: 12,
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)"
        }}
        role="img"
        aria-label={`${map.name} map`}
      >
        {map.routes.map((route) => {
          const a = cityAt(route.a);
          const b = cityAt(route.b);
          const owner = view.claims[route.id];
          const options = claimsByRoute.get(route.id);
          const claimable = Boolean(options?.length);
          // Parallel tracks are drawn either side of the centre line.
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const side = route.twin === undefined ? 0 : route.id < route.twin ? 1 : -1;
          const ox = (-dy / len) * 5 * side;
          const oy = (dx / len) * 5 * side;

          return (
            <g key={route.id}>
              <line
                x1={a.x + ox}
                y1={a.y + oy}
                x2={b.x + ox}
                y2={b.y + oy}
                stroke={owner !== undefined ? SEAT_HEX[owner % SEAT_HEX.length] : COLOUR_HEX[route.color]}
                strokeWidth={owner !== undefined ? 7 : 5}
                strokeLinecap="round"
                strokeDasharray={route.tunnel ? "8 5" : undefined}
                opacity={owner !== undefined ? 1 : claimable ? 1 : 0.55}
                style={{ cursor: claimable ? "pointer" : "default" }}
                onClick={() => {
                  if (!options?.length) return;
                  sfx("trainClack");
                  play(options[0]!);
                }}
              />
              {claimable && (
                <line
                  x1={a.x + ox}
                  y1={a.y + oy}
                  x2={b.x + ox}
                  y2={b.y + oy}
                  stroke="var(--accent)"
                  strokeWidth={11}
                  strokeLinecap="round"
                  opacity={0.25}
                  pointerEvents="none"
                />
              )}
              {route.ferry > 0 && (
                <text
                  x={(a.x + b.x) / 2 + ox}
                  y={(a.y + b.y) / 2 + oy - 7}
                  fontSize={10}
                  fill="var(--ink)"
                  textAnchor="middle"
                >
                  {"⚓".repeat(route.ferry)}
                </text>
              )}
            </g>
          );
        })}

        {map.cities.map((city) => {
          const owner = stationOwner(city.key);
          return (
            <g key={city.key}>
              <circle
                cx={city.x}
                cy={city.y}
                r={6}
                fill={owner ? SEAT_HEX[Number(owner) % SEAT_HEX.length] : "var(--panel)"}
                stroke="var(--ink)"
                strokeWidth={1.5}
              />
              <text
                x={city.x}
                y={city.y - 10}
                fontSize={11}
                fill="var(--ink)"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {city.name}
              </text>
            </g>
          );
        })}
      </svg>

      {/* market */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="gambit-mini"
          disabled={!draws.some((d) => d.from === "deck")}
          onClick={() => {
            sfx("cardDeal");
            play(draws.find((d) => d.from === "deck")!);
          }}
        >
          Deck · {view.deckCount}
        </button>
        {view.market.map((card, i) => {
          const move = draws.find((d) => d.from === i);
          return (
            <motion.button
              key={i}
              whileTap={{ scale: 0.94 }}
              disabled={!move}
              onClick={() => {
                sfx("cardDeal");
                play(move!);
              }}
              aria-label={card ?? "empty slot"}
              style={{
                width: 54,
                height: 74,
                borderRadius: 7,
                border: move ? "2px solid var(--accent)" : "1px solid var(--line)",
                background: card ? COLOUR_HEX[card] : "var(--panel2)",
                color: card === "white" || card === "yellow" ? "#2b2116" : "#f6efe2",
                fontSize: 11,
                cursor: move ? "pointer" : "default",
                opacity: card ? 1 : 0.4
              }}
            >
              {card === "loco" ? "★" : (card ?? "")}
            </motion.button>
          );
        })}
        {view.drawsLeft === 1 && (
          <span style={{ fontSize: 12, color: "var(--accent)" }}>one more draw</span>
        )}
        {ticketDraw && (
          <button
            className="gambit-mini"
            onClick={() => {
              sfx("cardSlip");
              play(ticketDraw);
            }}
          >
            Draw tickets
          </button>
        )}
      </div>

      {/* hand */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(view.hand as Hand).map(([card, count]) =>
          count > 0 ? (
            <span
              key={card}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                background: COLOUR_HEX[card],
                color: card === "white" || card === "yellow" ? "#2b2116" : "#f6efe2",
                fontSize: 13
              }}
            >
              {card === "loco" ? "★" : card} × {count}
            </span>
          ) : null
        )}
        {stations.length > 0 && (
          <span style={{ fontSize: 12, color: "var(--mut)", alignSelf: "center" }}>
            tap a city on the map to station it
          </span>
        )}
      </div>

      {/* tickets */}
      <div>
        <button className="gambit-mini" onClick={() => setShowTickets((s) => !s)}>
          {showTickets ? "Hide" : "Show"} tickets ({view.tickets.length})
        </button>
        {showTickets && (
          <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
            {view.tickets.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: "var(--panel2)",
                  border: `1px solid ${t.done ? "#5aa85f" : "var(--line)"}`,
                  fontSize: 13
                }}
              >
                <span>
                  {cityAt(t.a).name} → {cityAt(t.b).name}
                  {t.long && <span style={{ color: "var(--accent)" }}> · long</span>}
                </span>
                <span style={{ color: t.done ? "#5aa85f" : "var(--mut)" }}>
                  {t.done ? "✓ " : ""}
                  {t.points}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* seats */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }}>
        {Object.keys(view.cars)
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
              {view.names[s]} · {view.routeScore[s]}pts · {view.cars[s]} cars
              {view.stationsLeft[s] ? ` · ${view.stationsLeft[s]}⌂` : ""}
            </span>
          ))}
        {view.finalLap && <span style={{ color: "var(--accent)" }}>final lap</span>}
      </div>
    </div>
  );
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

export { routePoints };
