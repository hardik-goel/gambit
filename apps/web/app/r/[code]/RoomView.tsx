"use client";
/**
 * A table: the lobby before the game, the felt during it, the scoring after.
 *
 * The whole thing is game-agnostic — it asks the registry for a Board and hands
 * it a redacted view, its legal moves and a `play` function. Nothing here knows
 * what chess is.
 */
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ClientSnapshot, Room } from "@gambit/core";
import { CATALOG } from "@gambit/games";
import type { FinalScore, Seat } from "@gambit/sdk";
import {
  BRAND,
  Button,
  ConnectionDot,
  EventTicker,
  InviteSheet,
  Panel,
  ScoreReveal,
  SmallCaps,
  TableIntro,
  Toast,
  shareResult,
  useAudio,
  useReducedMotion,
  useTable,
  useTheme
} from "@gambit/ui";
import { ConfigPanel } from "./ConfigPanel";

export function RoomView({ roomId, code }: { roomId: string; code: string }) {
  const [snapshot, setSnapshot] = useState<(ClientSnapshot & { me: { playerId: string; name: string } }) | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) {
      setError("That table is gone.");
      return;
    }
    setSnapshot((await res.json()) as never);
  }, [roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!snapshot) {
    return (
      <main style={{ display: "grid", placeItems: "center", minHeight: "100dvh" }}>
        <div className="gambit-breathe" style={{ color: "var(--mut)", letterSpacing: 3 }}>
          setting the table…
        </div>
        <Toast message={error} onDone={() => setError(null)} />
      </main>
    );
  }

  return <Table key={snapshot.room.status} snapshot={snapshot} code={code} onReload={load} />;
}

function Table({
  snapshot,
  code,
  onReload
}: {
  snapshot: ClientSnapshot & { me: { playerId: string; name: string } };
  code: string;
  onReload(): void;
}) {
  const router = useRouter();
  const def = CATALOG[snapshot.gameId]!;
  const { theme } = useTheme();
  const { sfx } = useAudio();
  const reducedMotion = useReducedMotion();
  const [room, setRoom] = useState<Room>(snapshot.room);
  const [invite, setInvite] = useState<"here" | "online" | null>(null);
  const [intro, setIntro] = useState(snapshot.room.status === "playing");
  const [error, setError] = useState<string | null>(null);

  const { state, play } = useTable({
    def,
    roomId: snapshot.room.id,
    playerId: snapshot.me.playerId,
    seat: snapshot.seat,
    initial: {
      room: snapshot.room,
      view: snapshot.view,
      legal: snapshot.legal,
      current: snapshot.current,
      version: snapshot.version,
      seq: snapshot.seq,
      terminal: snapshot.terminal,
      scores: snapshot.scores ?? null,
      events: snapshot.history
    }
  });

  useEffect(() => {
    if (state.room) setRoom(state.room);
  }, [state.room]);

  // The lobby → felt transition happens on the room's status, from the server.
  useEffect(() => {
    if (room.status === "playing") setIntro((was) => was || snapshot.room.status !== "playing");
  }, [room.status, snapshot.room.status]);

  useEffect(() => {
    if (state.rejection) setError(state.rejection);
  }, [state.rejection]);

  const seats: Seat[] = useMemo(
    () =>
      room.players
        .filter((p) => p.seat !== null)
        .sort((a, b) => (a.seat as number) - (b.seat as number))
        .map((p) => ({
          id: p.seat as number,
          playerId: p.playerId,
          name: p.name,
          isBot: p.isBot,
          team: p.team
        })),
    [room.players]
  );

  const isHost = room.hostId === snapshot.me.playerId;
  const myTurn = state.seat !== null && state.current.includes(state.seat);
  const url = typeof location !== "undefined" ? `${location.origin}/r/${code}` : `/r/${code}`;

  async function act(body: Record<string, unknown>) {
    const res = await fetch(`/api/rooms/${room.id}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setError(data.error?.message ?? "That didn't work.");
      return false;
    }
    onReload();
    return true;
  }

  /* ------------------------------------------------------------- lobby */

  if (room.status === "lobby") {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "22px 18px 60px" }}>
        <Header code={code} gameName={def.meta.name} state={state} onLeave={() => router.push("/")} />

        <Panel style={{ padding: 20, display: "grid", gap: 18 }}>
          <div>
            <SmallCaps>{def.meta.name} · seats</SmallCaps>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {Array.from({ length: def.meta.maxPlayers }, (_, i) => {
                const holder = room.players.find((p) => p.seat === i);
                const mine = holder?.playerId === snapshot.me.playerId;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "var(--panel2)",
                      border: `1px solid ${mine ? "var(--accent)" : "var(--line)"}`
                    }}
                  >
                    <span style={{ color: "var(--mut)", fontSize: 12, width: 46 }}>SEAT {i + 1}</span>
                    <span style={{ flex: 1 }}>
                      {holder ? holder.name : <span style={{ color: "var(--mut)" }}>empty</span>}
                      {holder?.isBot && <span style={{ color: "var(--mut)" }}> · bot</span>}
                      {holder?.ready && !holder.isBot && <span style={{ color: "var(--accent)" }}> · ready</span>}
                    </span>
                    {!holder && (
                      <button className="gambit-mini" onClick={() => void act({ action: "seat", seat: i })}>
                        Sit here
                      </button>
                    )}
                    {holder && isHost && !mine && (
                      <button
                        className="gambit-mini"
                        onClick={() => void act({ action: "kick", playerId: holder.playerId })}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <ConfigPanel
            schema={def.configSchema}
            config={room.config}
            disabled={!isHost}
            onChange={(patch) => void act({ action: "config", config: patch })}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button
              onClick={() => {
                const me = room.players.find((p) => p.playerId === snapshot.me.playerId);
                void act({ action: "ready", ready: !me?.ready });
              }}
              variant="ghost"
            >
              {room.players.find((p) => p.playerId === snapshot.me.playerId)?.ready
                ? "Not ready"
                : "I'm ready"}
            </Button>
            {isHost && (
              <>
                <Button variant="ghost" onClick={() => void act({ action: "bot", level: 2 })}>
                  Add a bot
                </Button>
                <Button variant="ghost" onClick={() => void act({ action: "fill" })}>
                  Fill with bots
                </Button>
                <Button
                  onClick={async () => {
                    if (await act({ action: "start" })) {
                      sfx("start");
                      setIntro(true);
                    }
                  }}
                >
                  Start the game
                </Button>
              </>
            )}
            <Button variant="quiet" onClick={() => setInvite("here")}>
              Invite · QR
            </Button>
          </div>
        </Panel>

        {invite && (
          <InviteSheet
            code={code}
            url={url}
            gameName={def.meta.name}
            mode={invite}
            onClose={() => setInvite(null)}
            onEnter={() => setInvite(null)}
          />
        )}
        <Toast message={error} onDone={() => setError(null)} />
      </main>
    );
  }

  /* -------------------------------------------------------------- felt */

  const scores = (state.scores ?? snapshot.scores ?? null) as FinalScore[] | null;

  return (
    <main className="gambit-felt" style={{ minHeight: "100dvh", padding: "18px 14px 40px" }}>
      {intro && (
        <TableIntro
          gameName={def.meta.name}
          hue={def.meta.themeTokens.hue}
          felt={def.meta.themeTokens.felt}
          onDone={() => setIntro(false)}
        />
      )}

      <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gap: 16 }}>
        <Header code={code} gameName={def.meta.name} state={state} onLeave={() => router.push("/")} />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {seats.map((s) => {
            const active = state.current.includes(s.id);
            return (
              <div
                key={s.id}
                className={active ? "gambit-turn" : undefined}
                style={{
                  padding: "6px 12px",
                  borderRadius: 20,
                  fontSize: 13,
                  border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                  color: active ? "var(--accent)" : "var(--mut)",
                  background: s.id === state.seat ? "var(--panel)" : "transparent"
                }}
              >
                {s.name}
                {s.isBot && " · bot"}
                {s.id === state.seat && " · you"}
              </div>
            );
          })}
        </div>

        {state.view !== null && (
          <div style={{ display: "grid", placeItems: "center" }}>
            <def.Board
              view={state.view}
              legal={state.legal}
              seat={state.seat}
              seats={seats}
              play={play}
              pending={state.pending}
              events={state.events}
              sfx={sfx}
              reducedMotion={reducedMotion}
            />
          </div>
        )}

        {state.terminal && scores && (
          <ScoreReveal
            scores={scores}
            seats={seats}
            gameName={def.meta.name}
            hue={def.meta.themeTokens.hue}
            onRematch={isHost ? () => void act({ action: "rematch" }) : undefined}
            onShare={() =>
              void shareResult({
                gameName: def.meta.name,
                hue: def.meta.themeTokens.hue,
                theme,
                scores,
                seats,
                subtitle: `${seats.length} players · table ${code}`
              }).catch(() => setError("Couldn't build the share card."))
            }
          />
        )}

        <Panel style={{ padding: 14 }}>
          <SmallCaps>at the table</SmallCaps>
          <div style={{ marginTop: 8 }}>
            <EventTicker events={state.events} />
          </div>
        </Panel>

        {!myTurn && !state.terminal && (
          <div style={{ textAlign: "center", color: "var(--mut)", fontSize: 13 }}>
            waiting on {seats.filter((s) => state.current.includes(s.id)).map((s) => s.name).join(", ") || "the table"}
          </div>
        )}
      </div>

      <Toast message={error} onDone={() => setError(null)} />
    </main>
  );
}

function Header({
  code,
  gameName,
  state,
  onLeave
}: {
  code: string;
  gameName: string;
  state: { status: "connecting" | "live" | "reconnecting" | "offline"; pingMs: number | null };
  onLeave(): void;
}) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <button className="gambit-mini" onClick={onLeave} aria-label={`Back to ${BRAND}`}>
        ← shelf
      </button>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: "var(--mut)", fontVariant: "small-caps" }}>
          {gameName}
        </div>
        <div style={{ fontSize: 18, letterSpacing: 5, fontWeight: 700 }}>
          {code.slice(0, 3)}·{code.slice(3)}
        </div>
      </div>
      <ConnectionDot status={state.status} pingMs={state.pingMs} />
    </header>
  );
}
