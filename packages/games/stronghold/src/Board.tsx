"use client";
/**
 * The Stronghold table: the world as an SVG, borders drawn between neighbours,
 * garrisons as numbers on each territory. Tap yours, then tap where you're
 * going — the engine decides whether that is a reinforcement or an assault.
 */
import { motion } from "framer-motion";
import React, { useMemo, useState } from "react";
import type { BoardProps } from "@gambit/sdk";
import { REGIONS, TERRITORIES, byKey } from "./world";
import type { StrongholdMove, StrongholdView } from "./state";

const SEAT_HEX = ["#b0342a", "#2f5f9e", "#3d7a45", "#c9a227", "#6b4f9e", "#2e2a26"];
const NEUTRAL_HEX = "#6f6a63";

export function Board({ view, legal, seat, play, sfx, reducedMotion }: BoardProps<StrongholdView, StrongholdMove>) {
  const [from, setFrom] = useState<string | null>(null);
  const mySeat = seat ?? view.turn;

  const places = useMemo(
    () => new Map(legal.filter((m) => m.kind === "place").map((m) => [m.territory, m] as const)),
    [legal]
  );
  const attacks = useMemo(() => legal.filter((m) => m.kind === "attack"), [legal]);
  const fortifies = useMemo(() => legal.filter((m) => m.kind === "fortify"), [legal]);
  const occupies = useMemo(() => legal.filter((m) => m.kind === "occupy"), [legal]);
  const trades = useMemo(() => legal.filter((m) => m.kind === "trade"), [legal]);
  const endAttack = legal.find((m) => m.kind === "end-attack");
  const endTurn = legal.find((m) => m.kind === "end-turn");

  const targetsFrom = (key: string) => [
    ...attacks.filter((m) => m.from === key).map((m) => m.to),
    ...fortifies.filter((m) => m.from === key).map((m) => m.to)
  ];

  const colourOf = (key: string) => {
    const owner = view.owner[key];
    if (owner === null || owner === undefined) return NEUTRAL_HEX;
    if (owner < 0) return NEUTRAL_HEX;
    return SEAT_HEX[owner % SEAT_HEX.length]!;
  };

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const list: [string, string][] = [];
    for (const territory of TERRITORIES) {
      for (const border of territory.borders) {
        const key = [territory.key, border].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        list.push([territory.key, border]);
      }
    }
    return list;
  }, []);

  function tap(key: string) {
    const place = places.get(key);
    if (place) {
      sfx("cubePlace");
      play(place);
      return;
    }
    if (from) {
      const attack = attacks.find((m) => m.from === from && m.to === key);
      if (attack) {
        sfx("diceTumble");
        play(attack);
        setFrom(null);
        return;
      }
      const move = fortifies
        .filter((m) => m.from === from && m.to === key)
        .sort((a, b) => b.count - a.count)
        .at(0);
      if (move) {
        sfx("cubePlace");
        play(move);
        setFrom(null);
        return;
      }
    }
    setFrom(view.owner[key] === mySeat ? key : null);
    sfx("select");
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, width: "min(97vw, 940px)", maxWidth: "100%" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span style={{ color: "var(--accent)" }}>{view.phase}</span>
        {(view.toPlace[mySeat] ?? 0) > 0 && <span>{view.toPlace[mySeat]} armies to place</span>}
        {trades.length > 0 && (
          <button className="gambit-mini" onClick={() => play(trades[0]!)}>
            Trade a set (+{view.nextSetValue})
          </button>
        )}
        {endAttack && (
          <button className="gambit-mini" onClick={() => play(endAttack)}>
            Stop attacking
          </button>
        )}
        {endTurn && (
          <button className="gambit-mini" onClick={() => play(endTurn)}>
            End turn
          </button>
        )}
        {view.objective && (
          <span style={{ color: "var(--mut)" }} title="Only you can see this">
            objective: {describeObjective(view.objective)}
          </span>
        )}
      </div>

      {view.pending?.kind === "occupy" && view.occupation && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid var(--accent)",
            background: "var(--panel)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          <span style={{ fontSize: 14 }}>{view.pending.prompt}</span>
          {occupies.map((m) => (
            <button key={m.count} className="gambit-mini" onClick={() => play(m)}>
              {m.count}
            </button>
          ))}
        </div>
      )}

      <svg
        viewBox="0 0 980 600"
        style={{
          width: "100%",
          background: "var(--felt)",
          borderRadius: 12,
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow)"
        }}
        role="img"
        aria-label="Stronghold world map"
      >
        {REGIONS.map((region) => {
          const members = TERRITORIES.filter((x) => x.region === region.key);
          const cx = members.reduce((n, m) => n + m.x, 0) / members.length;
          const cy = members.reduce((n, m) => n + m.y, 0) / members.length;
          return (
            <text key={region.key} x={cx} y={cy} fontSize={13} fill={region.hue} opacity={0.5} textAnchor="middle">
              {region.name.toUpperCase()} +{region.bonus}
            </text>
          );
        })}

        {edges.map(([a, b]) => {
          const ta = byKey(a);
          const tb = byKey(b);
          // Borders that wrap the world are drawn short rather than across it.
          const far = Math.abs(ta.x - tb.x) > 500;
          if (far) return null;
          return (
            <line
              key={`${a}-${b}`}
              x1={ta.x}
              y1={ta.y}
              x2={tb.x}
              y2={tb.y}
              stroke="var(--line)"
              strokeWidth={1}
              opacity={0.5}
            />
          );
        })}

        {TERRITORIES.map((territory) => {
          const isMine = view.owner[territory.key] === mySeat;
          const lit = places.has(territory.key) || (from ? targetsFrom(from).includes(territory.key) : false);
          const selected = from === territory.key;
          return (
            <g
              key={territory.key}
              onClick={() => tap(territory.key)}
              style={{ cursor: isMine || lit ? "pointer" : "default" }}
            >
              <motion.circle
                cx={territory.x}
                cy={territory.y}
                r={lit ? 19 : 16}
                fill={colourOf(territory.key)}
                stroke={selected ? "var(--ink)" : lit ? "var(--accent)" : "rgba(0,0,0,.4)"}
                strokeWidth={selected || lit ? 3 : 1}
                // The radius is always animated to a real value. Handing
                // Framer an empty target for an SVG attribute it manages makes
                // it write `undefined`, which the browser rejects — 42 console
                // errors a render, one per territory, for anybody who has
                // reduced motion turned on.
                // `initial={false}` matters as much as the target: on mount
                // Framer resolves a "from" value for the attribute, and for an
                // SVG `r` there is nothing to read, so it wrote `undefined` and
                // the browser rejected it once per territory.
                initial={false}
                animate={{ r: lit ? 19 : 16 }}
                transition={{ duration: reducedMotion ? 0 : 0.18 }}
              />
              <text
                x={territory.x}
                y={territory.y + 5}
                fontSize={14}
                fontWeight={700}
                fill="#f6efe2"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {view.armies[territory.key]}
              </text>
              <text
                x={territory.x}
                y={territory.y - 21}
                fontSize={10}
                fill="var(--ink)"
                textAnchor="middle"
                style={{ pointerEvents: "none" }}
              >
                {territory.name}
              </text>
            </g>
          );
        })}
      </svg>

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
                color: SEAT_HEX[s % SEAT_HEX.length],
                textDecoration: view.eliminated.includes(s) ? "line-through" : undefined
              }}
            >
              {view.names[s]} · {Object.values(view.owner).filter((o) => o === s).length} territories ·{" "}
              {view.handCounts[s] ?? 0} cards
            </span>
          ))}
      </div>
    </div>
  );
}

function describeObjective(objective: NonNullable<StrongholdView["objective"]>): string {
  switch (objective.kind) {
    case "regions":
      return `hold ${objective.regions.map((r) => REGIONS.find((x) => x.key === r)?.name ?? r).join(" and ")}`;
    case "territories":
      return `hold ${objective.count} territories`;
    case "any-regions":
      return `hold any ${objective.count} regions`;
    case "eliminate":
      return `remove one rival, or hold ${objective.fallback} territories`;
    default:
      return "";
  }
}
