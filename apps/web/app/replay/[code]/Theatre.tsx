"use client";
/**
 * The replay theatre.
 *
 * Because every game is a pure function of (seed, seats, moves), a finished
 * table can be rebuilt exactly — so this is not a recording, it is the game
 * again. Scrub it, step it, share the link.
 */
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { FinalScore, Seat } from "@gambit/sdk";
import type { AnyGameDefinition } from "@gambit/sdk";
import { loadGame } from "@/lib/games.client";
import { Button, EventTicker, Panel, ScoreReveal, SmallCaps, useAudio, useReducedMotion } from "@gambit/ui";

interface Frame {
  ply: number;
  seat: number | null;
  view: unknown;
  events: { type: string; text?: string }[];
  description: string;
}

export function Theatre({ roomId, code }: { roomId: string; code: string }) {
  const router = useRouter();
  const { sfx } = useAudio();
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<{
    gameId: string;
    seats: Seat[];
    frames: Frame[];
    scores: FinalScore[];
  } | null>(null);
  const [def, setDef] = useState<AnyGameDefinition | null>(null);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    void fetch(`/api/rooms/${roomId}/replay`)
      .then((r) => r.json())
      .then(async (body: { gameId: string }) => {
        setData(body as never);
        setDef(await loadGame(body.gameId));
      })
      .catch(() => undefined);
  }, [roomId]);

  const step = useCallback(
    (delta: number) => {
      setAt((current) => {
        const max = (data?.frames.length ?? 1) - 1;
        return Math.max(0, Math.min(max, current + delta));
      });
    },
    [data]
  );

  useEffect(() => {
    if (!playing || !data) return;
    const timer = setInterval(() => {
      setAt((current) => {
        if (current >= data.frames.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 900);
    return () => clearInterval(timer);
  }, [playing, data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === " ") setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const frame = data?.frames[at];
  const history = useMemo(
    () => (data ? data.frames.slice(0, at + 1).flatMap((f) => f.events) : []),
    [data, at]
  );

  if (!data || !def || !frame) {
    return (
      <main style={{ display: "grid", placeItems: "center", minHeight: "60vh", color: "var(--mut)" }}>
        <span className="gambit-breathe">rolling the film back…</span>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 16px 60px", display: "grid", gap: 14 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <button className="gambit-mini" onClick={() => router.push("/")}>
          ← shelf
        </button>
        <SmallCaps style={{ margin: 0 }}>
          {def.meta.name} · table {code}
        </SmallCaps>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>
          move {at} / {data.frames.length - 1}
        </span>
      </header>

      <div style={{ display: "grid", placeItems: "center" }}>
        <def.Board
          view={frame.view}
          legal={[]}
          seat={null}
          seats={data.seats}
          play={() => undefined}
          pending={false}
          events={history}
          sfx={sfx}
          reducedMotion={reducedMotion}
        />
      </div>

      <Panel style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 14 }}>{frame.description}</div>
        <input
          type="range"
          min={0}
          max={data.frames.length - 1}
          value={at}
          onChange={(e) => setAt(Number(e.target.value))}
          aria-label="Scrub the replay"
          style={{ accentColor: "var(--accent)" }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="gambit-mini" onClick={() => step(-1)}>
            ◀ back
          </button>
          <button className="gambit-mini" onClick={() => setPlaying((p) => !p)}>
            {playing ? "pause" : "play"}
          </button>
          <button className="gambit-mini" onClick={() => step(1)}>
            forward ▶
          </button>
          <Button
            variant="quiet"
            onClick={() => {
              void navigator.clipboard?.writeText(location.href).catch(() => undefined);
            }}
          >
            Copy the link
          </Button>
        </div>
        <EventTicker events={history} />
      </Panel>

      {at === data.frames.length - 1 && data.scores.length > 0 && (
        <ScoreReveal
          scores={data.scores}
          seats={data.seats}
          gameName={def.meta.name}
          hue={def.meta.themeTokens.hue}
        />
      )}
    </main>
  );
}
