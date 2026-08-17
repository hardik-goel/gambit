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
import type { AnyGameDefinition } from "@gambit/sdk";
import { loadGame } from "@/lib/games.client";
import { track } from "@gambit/core";
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
import { usePeople } from "../../People";

export function RoomView({ roomId, code }: { roomId: string; code: string }) {
  const [snapshot, setSnapshot] = useState<(ClientSnapshot & { me: { playerId: string; name: string } }) | null>(
    null
  );
  // The game's own code arrives in its own chunk, alongside the snapshot.
  const [def, setDef] = useState<AnyGameDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) {
      setError("That table is gone.");
      return;
    }
    const body = (await res.json()) as ClientSnapshot & { me: { playerId: string; name: string } };
    setSnapshot(body);
    setDef(await loadGame(body.gameId));
  }, [roomId]);

  useEffect(() => {
    // Time to seated is the metric the ten-second promise lives or dies by, so
    // it is measured from the moment the page starts, not from the first render.
    const startedAt = performance.now();
    void load().then(() => {
      track({
        name: "time_to_seated",
        ms: Math.round(performance.now() + (performance.timing ? 0 : 0) - startedAt),
        players: 1,
        mode: "online"
      });
    });
  }, [load]);

  if (!snapshot || !def) {
    return (
      <main
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          placeItems: "center",
          minHeight: "100dvh"
        }}
      >
        <div className="gambit-breathe" style={{ color: "var(--mut)", letterSpacing: 3 }}>
          setting the table…
        </div>
        <Toast message={error} onDone={() => setError(null)} />
      </main>
    );
  }

  return <Table key={snapshot.room.status} def={def} snapshot={snapshot} code={code} onReload={load} />;
}

function Table({
  def,
  snapshot,
  code,
  onReload
}: {
  def: AnyGameDefinition;
  snapshot: ClientSnapshot & { me: { playerId: string; name: string } };
  code: string;
  onReload(): void;
}) {
  const router = useRouter();
  const { theme } = useTheme();
  const { sfx } = useAudio();
  const reducedMotion = useReducedMotion();
  const [room, setRoom] = useState<Room>(snapshot.room);
  const [invite, setInvite] = useState<"here" | "online" | null>(null);
  const [intro, setIntro] = useState(snapshot.room.status === "playing");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState<string[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const people = usePeople();

  useEffect(() => {
    try {
      const saved = localStorage.getItem("gambit.muted");
      if (saved) setMuted(JSON.parse(saved) as string[]);
    } catch {
      /* private mode */
    }
  }, []);

  const { state, play, chat: chatFn } = useTable({
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

  /**
   * The turn clock, driven by whoever is waiting on it.
   *
   * A serverless deployment has no process watching the tables, and the Hobby
   * plan's cron runs once a day. So the people at the table ask instead: while
   * the game is live and it is not our turn, we check whether the player to
   * move has run out of time. The server decides from its own timestamps — this
   * cannot bring anyone's clock forward, only notice that it has expired.
   *
   * The reply says how long is left, so the next question is asked when it is
   * worth asking rather than on a fixed drum.
   */
  useEffect(() => {
    if (room.status !== "playing" || room.turnTimeoutSec <= 0) return;
    // Our own clock is our business; we only watch somebody else's.
    if (snapshot.seat !== null && state.current.includes(snapshot.seat)) return;

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const ask = async (): Promise<void> => {
      if (!live || document.hidden) return schedule(15);
      try {
        const res = await fetch(`/api/rooms/${snapshot.room.id}/sweep`, { method: "POST" });
        const body = (await res.json()) as { remaining: number | null };
        schedule(Math.min(Math.max(body.remaining ?? 15, 5), 30));
      } catch {
        schedule(30); // offline, or the table has gone; try again later
      }
    };

    const schedule = (seconds: number): void => {
      if (!live) return;
      timer = setTimeout(() => void ask(), seconds * 1000);
    };

    schedule(5);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [room.status, room.turnTimeoutSec, state.current, snapshot.seat, snapshot.room.id]);

  // The move-latency budget: p95 input-to-acknowledgement under 150ms in-region.
  useEffect(() => {
    if (state.pingMs === null) return;
    track({ name: "move_latency", gameId: snapshot.gameId, ms: state.pingMs });
  }, [state.pingMs, snapshot.gameId]);

  const [copied, setCopied] = useState(false);
  const [myName, setMyName] = useState(
    room.players.find((p) => p.playerId === snapshot.me.playerId)?.name ?? snapshot.me.name
  );

  /** Save the name, and let the table see it — quietly, on blur. */
  const renameMe = useCallback(async () => {
    const clean = myName.trim().slice(0, 24);
    if (!clean || clean === room.players.find((p) => p.playerId === snapshot.me.playerId)?.name) return;
    await fetch("/api/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "profile", name: clean })
    }).catch(() => undefined);
    // Re-joining is what publishes the new name: the join path reads it from
    // the profile and broadcasts the room, so everybody at the table sees the
    // change without a bespoke action for it.
    await fetch(`/api/rooms/${snapshot.room.id}`).catch(() => undefined);
  }, [myName, room.players, snapshot.me.playerId, snapshot.room.id]);

  /** How many chairs are still empty — nothing may be added past zero. */
  const seatsLeft = Math.max(0, def.meta.maxPlayers - room.players.filter((p) => p.seat !== null).length);

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

  // Chat arrives on the room channel — which never carries game state — and is
  // echoed back to the sender too, so there is nothing to keep locally.
  const chat = state.chat.filter((line) => !muted.includes(line.playerId));
  const chatTo = (text: string) => chatFn(text);

  /** Muting is instant and local: you never have to file anything to stop reading someone. */
  function toggleMute(playerId: string) {
    const next = muted.includes(playerId) ? muted.filter((id) => id !== playerId) : [...muted, playerId];
    setMuted(next);
    try {
      localStorage.setItem("gambit.muted", JSON.stringify(next));
    } catch {
      /* private mode */
    }
  }

  async function report(subjectId: string) {
    await fetch(`/api/rooms/${room.id}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectId, reason: "abuse" })
    });
    setError("Reported. Thanks — we read these.");
  }

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
                    {mine ? (
                      // Your own name, changed where you are sitting. It was
                      // only editable from the people panel, which is not where
                      // anybody looks when they can see their name on a seat.
                      <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          value={myName}
                          onChange={(e) => setMyName(e.target.value.slice(0, 24))}
                          onBlur={() => void renameMe()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          aria-label="Your name at this table"
                          maxLength={24}
                          style={{
                            background: "transparent",
                            border: "1px solid var(--line)",
                            borderRadius: 8,
                            color: "var(--ink)",
                            font: "inherit",
                            fontSize: 15,
                            padding: "4px 8px",
                            minWidth: 0,
                            flex: "1 1 120px"
                          }}
                        />
                        {holder?.ready && <span style={{ color: "var(--accent)" }}>ready</span>}
                      </span>
                    ) : (
                      <span style={{ flex: 1 }}>
                        {holder ? holder.name : <span style={{ color: "var(--mut)" }}>empty</span>}
                        {holder?.isBot && <span style={{ color: "var(--mut)" }}> · bot</span>}
                        {holder?.ready && !holder.isBot && <span style={{ color: "var(--accent)" }}> · ready</span>}
                      </span>
                    )}
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

          {(people.data?.friends.length ?? 0) > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <SmallCaps>ask a friend</SmallCaps>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {people.data!.friends.map((friend) => {
                  const here = room.players.some((p) => p.playerId === friend.playerId);
                  return (
                    <button
                      key={friend.playerId}
                      className="gambit-mini"
                      disabled={here}
                      onClick={async () => {
                        const error = await people.act({
                          action: "invite",
                          playerId: friend.playerId,
                          roomId: room.id
                        });
                        setError(error ?? `Asked ${friend.name}.`);
                      }}
                    >
                      {friend.avatar} {friend.name}
                      {here ? " · here" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
            {/* How another person actually gets here. The lobby offered "sit
                here" — which only ever seats you — and a QR button whose
                purpose was not obvious, so a host with three empty chairs had
                no visible way to fill them with people. */}
            {seatsLeft > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  const link = `${location.origin}/r/${code}`;
                  void navigator.clipboard?.writeText(link).catch(() => undefined);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? "Link copied" : `Invite people · ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} free`}
              </Button>
            )}
            {isHost && (
              <>
                {/* Offered only while there is a seat to put one in. Both used
                    to stay live at a full table and answer "Every seat is
                    taken." — a button whose only outcome is an error. */}
                <Button
                  variant="ghost"
                  disabled={seatsLeft === 0}
                  onClick={() => void act({ action: "bot", level: 2 })}
                >
                  Add a bot
                </Button>
                <Button
                  variant="ghost"
                  disabled={seatsLeft === 0}
                  onClick={() => void act({ action: "fill" })}
                >
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
                title={s.isBot || s.id === state.seat ? undefined : "Tap to mute or report"}
                onClick={() => {
                  if (s.isBot || s.id === state.seat) return;
                  setMenuFor(menuFor === s.playerId ? null : s.playerId);
                }}
              >
                {s.name}
                {s.isBot && " · bot"}
                {s.id === state.seat && " · you"}
                {muted.includes(s.playerId) && " · muted"}
              </div>
            );
          })}
        </div>

        {state.view !== null && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center" }}>
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

        {menuFor && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="gambit-mini" onClick={() => { toggleMute(menuFor); setMenuFor(null); }}>
              {muted.includes(menuFor) ? "Unmute" : "Mute"}
            </button>
            <button className="gambit-mini" onClick={() => { void report(menuFor); setMenuFor(null); }}>
              Report
            </button>
            <button className="gambit-mini" onClick={() => setMenuFor(null)}>
              Cancel
            </button>
          </div>
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

        {state.seat === null && (
          <div style={{ textAlign: "center", color: "var(--mut)", fontSize: 13 }}>
            you're watching this table — hands and secrets stay hidden
          </div>
        )}

        {state.terminal && (
          <div style={{ textAlign: "center" }}>
            <Button variant="ghost" onClick={() => router.push(`/replay/${code}`)}>
              Watch the replay
            </Button>
          </div>
        )}

        <Panel style={{ padding: 12, display: "grid", gap: 8 }}>
          <SmallCaps>table talk</SmallCaps>
          <div style={{ maxHeight: 120, overflowY: "auto", display: "grid", gap: 4, fontSize: 13 }}>
            {chat.slice(-30).map((line, i) => (
              <div key={i}>
                <span style={{ color: "var(--accent)" }}>{line.name}</span>{" "}
                <span>{line.emote ?? line.text}</span>
              </div>
            ))}
            {chat.length === 0 && <span style={{ color: "var(--mut)" }}>nobody's said anything yet</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Nice one", "Ouch", "Your turn", "Good game", "😀", "🔥"].map((phrase) => (
              <button
                key={phrase}
                className="gambit-mini"
                onClick={() => {
                  chatTo(phrase);
                }}
              >
                {phrase}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !draft.trim()) return;
                chatTo(draft.trim());
                setDraft("");
              }}
              placeholder="say something"
              aria-label="Chat message"
              maxLength={280}
              style={{
                flex: 1,
                background: "var(--panel2)",
                border: "1px solid var(--line)",
                color: "var(--ink)",
                borderRadius: 8,
                padding: "8px 10px",
                fontFamily: "inherit",
                fontSize: 14
              }}
            />
          </div>
        </Panel>
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
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <MusicToggle />
        <ConnectionDot status={state.status} pingMs={state.pingMs} />
      </div>
    </header>
  );
}

/** One press to stop the music, from the table as well as the shelf. */
function MusicToggle() {
  const { settings, update } = useAudio();
  return (
    <button
      className="gambit-mini"
      aria-label={settings.music ? "Stop the music" : "Play music"}
      aria-pressed={settings.music}
      title={settings.music ? "Stop the music" : "Play music"}
      onClick={() => update({ music: !settings.music })}
      style={{ color: settings.music ? "var(--accent)" : "var(--mut)" }}
    >
      {settings.music ? "♪" : "♪̸"}
    </button>
  );
}
