"use client";
/**
 * The Shelf — Gambit's front door.
 *
 * Games are physical objects here: box spines standing on a plank, leaning out
 * when you touch them, catching the lamp light as you drag. The whole point is
 * that choosing a game feels like reaching for one.
 */
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import React, { useMemo, useRef, useState } from "react";
import { useReducedMotion, useSfx } from "../providers";
import { Button, Meta, SmallCaps } from "./primitives";

export interface ShelfGame {
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  players: string;
  minutes: number;
  complexity: number;
  badges: string[];
  hue: string;
  felt: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface ShelfFilter {
  id: string;
  label: string;
  match(g: ShelfGame): boolean;
}

export const SHELF_FILTERS: ShelfFilter[] = [
  { id: "all", label: "All", match: () => true },
  { id: "two", label: "For 2", match: (g) => g.minPlayers <= 2 && g.maxPlayers >= 2 },
  { id: "party", label: "Big table", match: (g) => g.maxPlayers >= 5 },
  { id: "quick", label: "Under 35 min", match: (g) => g.minutes <= 35 },
  { id: "coop", label: "Co-op", match: (g) => g.badges.includes("Co-op") },
  { id: "teams", label: "Teams", match: (g) => g.badges.includes("Teams") },
  {
    id: "hidden",
    label: "Hidden roles",
    match: (g) => g.badges.includes("Hidden role") || g.badges.includes("Deduction")
  },
  { id: "simple", label: "Teach in 2 min", match: (g) => g.complexity <= 2 }
];

export function Shelf({
  games,
  selectedId,
  onSelect,
  onPlayHere,
  onPlayOnline,
  onTutorial,
  onQuickMatch,
  waiting = {}
}: {
  games: ShelfGame[];
  selectedId: string;
  onSelect(id: string): void;
  onPlayHere(id: string): void;
  onPlayOnline(id: string): void;
  onTutorial(id: string): void;
  onQuickMatch?(id: string): void;
  /** How many people are waiting for each game right now. */
  waiting?: Record<string, number>;
}) {
  const [filter, setFilter] = useState("all");
  const sfx = useSfx();
  const shown = useMemo(
    () => games.filter((g) => SHELF_FILTERS.find((f) => f.id === filter)?.match(g) ?? true),
    [games, filter]
  );
  const selected = games.find((g) => g.id === selectedId);
  const selectedVisible = shown.some((g) => g.id === selectedId);

  return (
    <div>
      <div
        style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 10 }}
        role="tablist"
        aria-label="Filter the shelf"
      >
        {SHELF_FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => {
              setFilter(f.id);
              sfx("select");
            }}
            style={{
              padding: "7px 14px",
              borderRadius: 20,
              fontSize: 13,
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
              border: `1px solid ${filter === f.id ? "var(--accent)" : "var(--line)"}`,
              background: filter === f.id ? "var(--accent)" : "transparent",
              color: filter === f.id ? "var(--bg)" : "var(--mut)",
              transition: "all .18s ease"
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <SmallCaps style={{ margin: "10px 2px" }}>the shelf · {shown.length} games</SmallCaps>

      <div style={{ position: "relative", marginBottom: 6 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            overflowX: "auto",
            padding: "26px 6px 0",
            alignItems: "flex-end",
            scrollSnapType: "x proximity"
          }}
        >
          <AnimatePresence initial={false}>
            {shown.map((g, i) => (
              <Spine
                key={g.id}
                game={g}
                index={i}
                selected={g.id === selectedId}
                onSelect={() => {
                  onSelect(g.id);
                  sfx("swoosh");
                }}
              />
            ))}
          </AnimatePresence>
          {shown.length === 0 && (
            <div style={{ color: "var(--mut)", padding: 30, fontStyle: "italic" }}>
              Nothing on the shelf for that filter yet.
            </div>
          )}
        </div>
        {/* the plank */}
        <div
          style={{
            height: 12,
            borderRadius: 3,
            background: "linear-gradient(180deg,var(--panel2),var(--panel))",
            border: "1px solid var(--line)",
            boxShadow: "0 12px 22px rgba(0,0,0,.35)"
          }}
        />
      </div>

      <AnimatePresence mode="wait">
        {selected && selectedVisible && (
          <GameCard
            key={selected.id}
            game={selected}
            onPlayHere={() => onPlayHere(selected.id)}
            onPlayOnline={() => onPlayOnline(selected.id)}
            onTutorial={() => onTutorial(selected.id)}
            onQuickMatch={onQuickMatch ? () => onQuickMatch(selected.id) : undefined}
            waiting={waiting[selected.id] ?? 0}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Spine({
  game,
  index,
  selected,
  onSelect
}: {
  game: ShelfGame;
  index: number;
  selected: boolean;
  onSelect(): void;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLButtonElement>(null);
  const px = useMotionValue(0);
  const tilt = useSpring(px, { stiffness: 260, damping: 18 });
  const rotate = useTransform(tilt, [-1, 1], [-7, 7]);
  const shine = useTransform(tilt, [-1, 1], [0.05, 0.28]);

  return (
    <motion.button
      ref={ref}
      layout
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${game.name} — ${game.tagline}`}
      initial={{ opacity: 0, y: 26 }}
      animate={{
        opacity: 1,
        y: selected ? -14 : 0,
        height: selected ? 226 : 200
      }}
      exit={{ opacity: 0, y: 20 }}
      transition={
        reduced
          ? { duration: 0 }
          : { type: "spring", stiffness: 340, damping: 24, delay: Math.min(index * 0.025, 0.3) }
      }
      onPointerMove={(e) => {
        if (reduced) return;
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        px.set(((e.clientX - r.left) / r.width) * 2 - 1);
      }}
      onPointerLeave={() => px.set(0)}
      style={{
        flex: "0 0 auto",
        width: 66,
        borderRadius: "7px 7px 3px 3px",
        cursor: "pointer",
        padding: 0,
        scrollSnapAlign: "center",
        background: `linear-gradient(180deg, ${game.hue} 0%, ${game.hue}cc 58%, var(--panel) 132%)`,
        border: "1px solid var(--line)",
        boxShadow: selected
          ? "0 16px 30px rgba(0,0,0,.5), 0 0 0 2px var(--accent)"
          : "0 6px 14px rgba(0,0,0,.35)",
        rotate,
        transformPerspective: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden"
      }}
    >
      {/* lamp-glow sweep, tracks the pointer */}
      <motion.span
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(105deg, transparent 30%, #fff 50%, transparent 70%)",
          opacity: shine,
          pointerEvents: "none"
        }}
      />
      <span
        style={{
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          fontSize: 15,
          letterSpacing: 2.6,
          fontWeight: 700,
          color: "#f6efe2",
          textShadow: "0 1px 3px rgba(0,0,0,.55)"
        }}
      >
        {game.name.toUpperCase()}
      </span>
      <span
        style={{
          position: "absolute",
          bottom: 8,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 10,
          color: "#f6efe2",
          opacity: 0.85
        }}
      >
        {game.players}
      </span>
    </motion.button>
  );
}

function GameCard({
  game,
  onPlayHere,
  onPlayOnline,
  onTutorial,
  onQuickMatch,
  waiting
}: {
  game: ShelfGame;
  onPlayHere(): void;
  onPlayOnline(): void;
  onTutorial(): void;
  onQuickMatch?(): void;
  waiting: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      style={{
        marginTop: 24,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "var(--shadow)"
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        <div
          style={{
            // Grows once it wraps. Fixed at 230px it kept that width on its own
            // line on a phone, leaving a dead strip of panel beside the cover.
            flex: "1 1 230px",
            minHeight: 200,
            background: `linear-gradient(145deg, ${game.hue}, ${game.hue}88 68%, ${game.felt})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative"
          }}
        >
          <div
            style={{
              fontSize: 27,
              letterSpacing: 4,
              fontWeight: 700,
              color: "#f6efe2",
              textShadow: "0 2px 8px rgba(0,0,0,.45)"
            }}
          >
            {game.name.toUpperCase()}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 12,
              fontSize: 11,
              letterSpacing: 2,
              color: "#f6efe2",
              opacity: 0.85
            }}
          >
            {game.tagline.toUpperCase()}
          </div>
        </div>

        <div style={{ flex: "1 1 340px", padding: "20px 22px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <Meta label={`${game.players} players`} />
            <Meta label={`~${game.minutes} min`} />
            <Meta label={`complexity ${"●".repeat(game.complexity)}${"○".repeat(Math.max(0, 5 - game.complexity))}`} />
            {game.badges.map((b) => (
              <Meta key={b} label={b} accent />
            ))}
          </div>
          <p style={{ fontSize: 16, lineHeight: 1.55, margin: "0 0 18px" }}>{game.blurb}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button cue="open" onClick={onPlayHere}>
              Play here · same room
            </Button>
            <Button variant="ghost" cue="open" onClick={onPlayOnline}>
              Play online · invite friends
            </Button>
            {onQuickMatch && (
              <Button variant="ghost" cue="open" onClick={onQuickMatch}>
                Quick match
                {waiting > 0 && (
                  <span style={{ color: "var(--accent)" }}> · {waiting} waiting</span>
                )}
              </Button>
            )}
            <Button variant="quiet" onClick={onTutorial}>
              2-min tutorial
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
