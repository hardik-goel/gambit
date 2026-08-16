"use client";
/**
 * The Remedy table: the world with its cubes, the team's hands side by side —
 * this is a co-op, so everyone plans from the same information — and the two
 * tracks that are quietly counting down.
 */
import { motion } from "framer-motion";
import React, { useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import { CITIES, ROLE_NAMES, ZONES, ZONE_HEX, ZONE_NAMES, cityById } from "./world";
import type { RemedyMove, RemedyView } from "./state";

const SEAT_HEX = ["#e8e0cd", "#f0b46b", "#9fd6cf", "#d6a2c8", "#a8c4e4"];

export function Board({ view, legal, seat, play, sfx, reducedMotion }: BoardProps<RemedyView, RemedyMove>) {
  const mySeat = seat ?? view.turn;
  const [selected, setSelected] = useState<number | null>(null);

  const movesTo = useMemo(() => {
    const map = new Map<number, RemedyMove[]>();
    for (const m of legal) {
      if ("to" in m && typeof m.to === "number") map.set(m.to, [...(map.get(m.to) ?? []), m]);
    }
    return map;
  }, [legal]);

  const treats = legal.filter((m): m is Extract<RemedyMove, { kind: "treat" }> => m.kind === "treat");
  const cures = legal.filter((m): m is Extract<RemedyMove, { kind: "cure" }> => m.kind === "cure");
  const build = legal.find((m) => m.kind === "build");
  const shares = legal.filter((m): m is Extract<RemedyMove, { kind: "share" }> => m.kind === "share");
  const discards = legal.filter((m): m is Extract<RemedyMove, { kind: "discard" }> => m.kind === "discard");
  const consents = legal.filter((m): m is Extract<RemedyMove, { kind: "consent" }> => m.kind === "consent");
  const endTurn = legal.find((m) => m.kind === "end-turn");

  return (
    <div style={{ display: "grid", gap: 12, width: "min(97vw, 900px)", maxWidth: "100%" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span style={{ color: "var(--accent)" }}>{view.actionsLeft} actions left</span>
        <span>outbreaks {view.outbreaks}/{view.outbreakLimit}</span>
        <span>infection rate {view.infectionRate}</span>
        <span>{view.playerDeckCount} cards left</span>
        {ZONES.map((zone) => (
          <span
            key={zone}
            style={{
              padding: "3px 8px",
              borderRadius: 10,
              border: `1px solid ${ZONE_HEX[zone]}`,
              color: ZONE_HEX[zone],
              opacity: view.cured[zone] ? 1 : 0.55
            }}
          >
            {ZONE_NAMES[zone]} {view.eradicated[zone] ? "✦" : view.cured[zone] ? "✔" : `· ${view.supply[zone]}`}
          </span>
        ))}
        {endTurn && (
          <button className="gambit-mini" onClick={() => play(endTurn)}>
            End turn
          </button>
        )}
      </div>

      {view.pending && (
        <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--accent)", background: "var(--panel)" }}>
          <div style={{ fontSize: 14, marginBottom: 8 }}>{view.pending.prompt}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {consents.map((m) => (
              <button key={String(m.agree)} className="gambit-mini" onClick={() => play(m)}>
                {m.agree ? "Go with them" : "Stay here"}
              </button>
            ))}
            {discards.map((m) => (
              <button key={m.card} className="gambit-mini" onClick={() => play(m)}>
                Discard {cityById(m.card).name}
              </button>
            ))}
          </div>
        </div>
      )}

      <svg
        viewBox="0 0 980 620"
        style={{
          width: "100%",
          background: "var(--felt)",
          borderRadius: 12,
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)"
        }}
        role="img"
        aria-label="Remedy world map"
      >
        {CITIES.flatMap((city) =>
          city.links
            .filter((other) => other > city.id)
            .map((other) => (
              <line
                key={`${city.id}-${other}`}
                x1={city.x}
                y1={city.y}
                x2={cityById(other).x}
                y2={cityById(other).y}
                stroke="var(--line)"
                strokeWidth={1}
                opacity={0.6}
              />
            ))
        )}

        {CITIES.map((city) => {
          const options = movesTo.get(city.id);
          const pawns = Object.keys(view.positions)
            .map(Number)
            .filter((s) => view.positions[s] === city.id);
          const lab = view.labs.includes(city.id);
          return (
            <g
              key={city.id}
              style={{ cursor: options?.length ? "pointer" : "default" }}
              onClick={() => {
                if (!options?.length) return;
                if (options.length === 1) {
                  sfx("pieceSet");
                  play(options[0]!);
                  return;
                }
                setSelected(city.id);
              }}
            >
              {lab && (
                <rect
                  x={city.x - 11}
                  y={city.y - 11}
                  width={22}
                  height={22}
                  rx={4}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                />
              )}
              <circle
                cx={city.x}
                cy={city.y}
                r={7}
                fill={ZONE_HEX[city.zone]}
                stroke={options?.length ? "var(--accent)" : "rgba(0,0,0,.45)"}
                strokeWidth={options?.length ? 2.5 : 1}
              />
              {/* cubes */}
              {ZONES.flatMap((zone) =>
                Array.from({ length: view.cubes[city.id]?.[zone] ?? 0 }, (_, i) => (
                  <motion.rect
                    key={`${zone}-${i}`}
                    initial={reducedMotion ? false : { scale: 0 }}
                    animate={{ scale: 1 }}
                    x={city.x + 9 + i * 6}
                    y={city.y - 12 + ZONES.indexOf(zone) * 7}
                    width={5}
                    height={5}
                    fill={ZONE_HEX[zone]}
                    stroke="rgba(0,0,0,.5)"
                    strokeWidth={0.5}
                  />
                ))
              )}
              {pawns.map((s, i) => (
                <circle
                  key={s}
                  cx={city.x - 10 - i * 7}
                  cy={city.y - 9}
                  r={4}
                  fill={SEAT_HEX[s % SEAT_HEX.length]}
                  stroke="rgba(0,0,0,.6)"
                />
              ))}
              <text
                x={city.x}
                y={city.y + 20}
                fontSize={9}
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

      {selected !== null && (movesTo.get(selected)?.length ?? 0) > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13 }}>To {cityById(selected).name}:</span>
          {movesTo.get(selected)!.map((m, i) => (
            <button
              key={i}
              className="gambit-mini"
              onClick={() => {
                sfx("swoosh");
                play(m);
                setSelected(null);
              }}
            >
              {m.kind}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {treats.map((m) => (
          <button
            key={m.zone}
            className="gambit-mini"
            style={{ borderColor: ZONE_HEX[m.zone], color: ZONE_HEX[m.zone] }}
            onClick={() => {
              sfx("cure");
              play(m);
            }}
          >
            Treat {m.zone}
          </button>
        ))}
        {build && (
          <button className="gambit-mini" onClick={() => play(build)}>
            Build a laboratory
          </button>
        )}
        {cures.map((m) => (
          <button
            key={m.zone}
            className="gambit-mini"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            onClick={() => {
              sfx("cure");
              play(m);
            }}
          >
            Cure {ZONE_NAMES[m.zone]}
          </button>
        ))}
        {shares.slice(0, 6).map((m, i) => (
          <button key={i} className="gambit-mini" onClick={() => play(m)}>
            {m.give ? "Give" : "Take"} {cityById(m.card).name}
          </button>
        ))}
      </div>

      {/* the team */}
      <div style={{ display: "grid", gap: 6 }}>
        {Object.keys(view.roles)
          .map(Number)
          .map((s) => (
            <div
              key={s}
              className={view.turn === s ? "gambit-turn" : undefined}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${view.turn === s ? "var(--accent)" : "var(--line)"}`,
                background: "var(--panel)",
                fontSize: 12
              }}
            >
              <span style={{ color: SEAT_HEX[s % SEAT_HEX.length], minWidth: 120 }}>
                {view.names[s]} · {ROLE_NAMES[view.roles[s]!]}
              </span>
              <span style={{ color: "var(--mut)" }}>in {cityById(view.positions[s]!).name}</span>
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(view.hands[s] ?? []).map((card) => (
                  <span
                    key={card}
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: ZONE_HEX[cityById(card).zone],
                      color: "#1b1b1b",
                      fontSize: 10
                    }}
                  >
                    {cityById(card).name}
                  </span>
                ))}
              </span>
            </div>
          ))}
      </div>

      {view.finished && (
        <div style={{ fontSize: 15, color: view.outcome === "won" ? "var(--accent)" : "#d1685c" }}>
          {view.outcome === "won" ? "Every affliction cured." : view.lostBecause}
        </div>
      )}
    </div>
  );
}
