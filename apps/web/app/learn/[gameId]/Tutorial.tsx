"use client";
/**
 * The tutorial runner.
 *
 * It plays the real game — the real `createState`, the real `legalMoves`, the
 * real board — locally, against the game's own bot, with a coach bubble walking
 * through the script the game ships. Nothing is faked, which is why a tutorial
 * can never drift out of step with the rules.
 */
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Rng, type BaseState } from "@gambit/sdk";
import type { AnyGameDefinition } from "@gambit/sdk";
import { loadGame } from "@/lib/games.client";
import { track } from "@gambit/core";
import { Button, Panel, SmallCaps, Toast, useAudio, useReducedMotion } from "@gambit/ui";

export function Tutorial({ gameId }: { gameId: string }) {
  const [def, setDef] = useState<AnyGameDefinition | null>(null);
  useEffect(() => {
    void loadGame(gameId).then(setDef);
  }, [gameId]);
  if (!def) return <Loading />;
  return <Coach gameId={gameId} def={def} />;
}

function Loading() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "60vh", color: "var(--mut)" }}>
      <span className="gambit-breathe">setting out the pieces…</span>
    </main>
  );
}

function Coach({ gameId, def }: { gameId: string; def: AnyGameDefinition }) {
  const router = useRouter();
  const { sfx } = useAudio();
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const seats = useMemo(
    () =>
      Array.from({ length: Math.max(def.Tutorial.seats, def.meta.minPlayers) }, (_, i) => ({
        id: i,
        playerId: i === 0 ? "you" : `bot:${i}`,
        name: i === 0 ? "You" : `Bot ${i}`,
        isBot: i !== 0,
        botLevel: 1 as const
      })),
    [def]
  );

  const [state, setState] = useState<BaseState>(() => {
    track({ name: "tutorial_started", gameId });
    return def.createState(def.configSchema.parse({}), seats, def.Tutorial.seed) as BaseState;
  });

  const current = def.currentSeats(state);
  const myTurn = current.includes(0);
  const legal = myTurn ? def.legalMoves(state, 0) : [];
  const view = def.redactStateFor(state, 0);
  const script = def.Tutorial.steps;

  /** Apply a move, then let the bots answer until it is the learner's turn. */
  const play = useCallback(
    (move: unknown) => {
      const res = def.applyMove(state, 0, move);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      let next = res.value.state as BaseState;
      const rng = new Rng(`${def.Tutorial.seed}:coach`);
      for (let i = 0; i < 60; i++) {
        if (def.isTerminal(next)) break;
        const actors = def.currentSeats(next);
        if (actors.length === 0 || actors.includes(0)) break;
        const seat = actors[0]!;
        const options = def.legalMoves(next, seat);
        if (options.length === 0) break;
        const botMove = def.bot(def.redactStateFor(next, seat), options, rng, 1);
        const applied = def.applyMove(next, seat, botMove);
        if (!applied.ok) break;
        next = applied.value.state as BaseState;
      }
      setState(next);
      setStep((s) => Math.min(s + 1, script.length - 1));
      if (step + 1 >= script.length - 1) {
        track({ name: "tutorial_completed", gameId, steps: script.length });
      }
    },
    [def, state, script.length, step, gameId]
  );

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px 60px", display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <button className="gambit-mini" onClick={() => router.push("/")}>
          ← shelf
        </button>
        <SmallCaps style={{ margin: 0 }}>{def.meta.name} · two-minute table</SmallCaps>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>
          {step + 1} / {script.length}
        </span>
      </header>

      <Panel style={{ padding: 16, borderColor: "var(--accent)" }}>
        <div style={{ fontSize: 16, lineHeight: 1.5 }}>{script[step]?.text}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {step > 0 && (
            <button className="gambit-mini" onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </button>
          )}
          {step < script.length - 1 && (
            <button
              className="gambit-mini"
              onClick={() => {
                setStep((s) => s + 1);
                sfx("tap");
              }}
            >
              Next
            </button>
          )}
          {script[step]?.demoMove !== undefined && (
            <button className="gambit-mini" onClick={() => play(script[step]!.demoMove)}>
              Show me
            </button>
          )}
          {step === script.length - 1 && (
            <Button
              onClick={() => {
                track({ name: "tutorial_completed", gameId, steps: script.length });
                router.push("/");
              }}
            >
              I'm ready — open a table
            </Button>
          )}
        </div>
      </Panel>

      <div style={{ display: "grid", placeItems: "center" }}>
        <def.Board
          view={view}
          legal={legal}
          seat={0}
          seats={seats}
          play={play}
          pending={false}
          events={[]}
          sfx={sfx}
          reducedMotion={reducedMotion}
        />
      </div>

      <div style={{ textAlign: "center", fontSize: 12, color: "var(--mut)" }}>
        This is the real game, played on your device. Nothing here is a mock-up.
      </div>

      <Toast message={error} onDone={() => setError(null)} />
    </main>
  );
}
