"use client";
/**
 * The final scoring reveal: categories land one at a time, numbers count up,
 * the winner gets confetti in the game's own colours. This is the moment people
 * screenshot, so it gets a share card at the end of it.
 */
import { motion } from "framer-motion";
import React, { useEffect, useMemo, useState } from "react";
import type { FinalScore, Seat } from "@gambit/sdk";
import { useAudio, useReducedMotion } from "../providers";
import { Button, Panel, SmallCaps } from "./primitives";

export function ScoreReveal({
  scores,
  seats,
  gameName,
  hue,
  onRematch,
  onShare
}: {
  scores: FinalScore[];
  seats: Seat[];
  gameName: string;
  hue: string;
  onRematch?(): void;
  onShare?(): void;
}) {
  const reduced = useReducedMotion();
  const { sfx, duck } = useAudio();
  const categories = useMemo(() => {
    const names: string[] = [];
    for (const s of scores) for (const l of s.lines) if (!names.includes(l.label)) names.push(l.label);
    return names;
  }, [scores]);
  const [step, setStep] = useState(reduced ? categories.length + 1 : 0);

  useEffect(() => {
    if (reduced) return;
    if (step > categories.length) return;
    const t = setTimeout(() => {
      setStep((s) => s + 1);
      sfx(step === categories.length ? "win" : "score");
      if (step === categories.length) duck(2200);
    }, step === 0 ? 500 : 780);
    return () => clearTimeout(t);
  }, [step, categories.length, reduced, sfx, duck]);

  const ordered = scores.slice().sort((a, b) => a.rank - b.rank);
  const done = step > categories.length;

  return (
    <Panel style={{ padding: 22, position: "relative", overflow: "hidden" }}>
      {done && !reduced && <Confetti hue={hue} />}
      <SmallCaps>{gameName} · final scoring</SmallCaps>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {ordered.map((s) => {
          const seat = seats.find((x) => x.id === s.seat);
          const shown = s.lines.filter((l) => categories.indexOf(l.label) < step);
          const running = shown.reduce((n, l) => n + l.value, 0);
          return (
            <motion.div
              key={s.seat}
              layout
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 12,
                background: s.won && done ? `${hue}22` : "var(--panel2)",
                border: `1px solid ${s.won && done ? hue : "var(--line)"}`
              }}
            >
              <div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>
                  {seat?.name ?? `Seat ${s.seat + 1}`}
                  {s.won && done && <span style={{ color: hue, marginLeft: 8 }}>winner</span>}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                  {shown.map((l) => (
                    <motion.span
                      key={l.label}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{ fontSize: 12, color: "var(--mut)" }}
                    >
                      {l.label} {l.value >= 0 ? "+" : ""}
                      {l.value}
                    </motion.span>
                  ))}
                </div>
              </div>
              <CountUp value={done ? s.total : running} />
            </motion.div>
          );
        })}
      </div>

      {done && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}
        >
          {onRematch && <Button onClick={onRematch}>Rematch, same table</Button>}
          {onShare && (
            <Button variant="ghost" onClick={onShare}>
              Share the result
            </Button>
          )}
        </motion.div>
      )}
    </Panel>
  );
}

function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const from = shown;
    const delta = value - from;
    if (delta === 0) return;
    const startedAt = performance.now();
    const dur = Math.min(600, 120 + Math.abs(delta) * 18);
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - startedAt) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + delta * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div style={{ fontSize: 30, fontWeight: 700, alignSelf: "center", fontVariantNumeric: "tabular-nums" }}>
      {shown}
    </div>
  );
}

function Confetti({ hue }: { hue: string }) {
  const bits = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.5,
        rot: Math.random() * 360,
        size: 5 + Math.random() * 7,
        color: [hue, "var(--accent)", "var(--ink)"][i % 3] as string
      })),
    [hue]
  );
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} aria-hidden>
      {bits.map((b) => (
        <motion.span
          key={b.id}
          initial={{ y: -20, opacity: 1, rotate: 0 }}
          animate={{ y: 420, opacity: [1, 1, 0], rotate: b.rot }}
          transition={{ duration: 2.2 + Math.random(), delay: b.delay, ease: "easeIn" }}
          style={{
            position: "absolute",
            left: `${b.x}%`,
            width: b.size,
            height: b.size * 1.6,
            borderRadius: 2,
            background: b.color
          }}
        />
      ))}
    </div>
  );
}
