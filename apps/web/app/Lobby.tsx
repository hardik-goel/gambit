"use client";
/** The front door: the shelf, the room controls, and the ten-second invite. */
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import {
  BRAND,
  Button,
  InviteSheet,
  Logo,
  Panel,
  Shelf,
  SmallCaps,
  SoundPanel,
  TAGLINE,
  ThemePicker,
  Toast,
  useAudio,
  type ShelfGame
} from "@gambit/ui";
import { addAnalyticsSink, track } from "@gambit/core";
import { People, usePeople } from "./People";

export function Lobby({
  games,
  initialGameId
}: {
  games: ShelfGame[];
  initialGameId?: string;
}) {
  const router = useRouter();
  const { settings, update } = useAudio();
  const [selected, setSelected] = useState(initialGameId ?? games[0]?.id ?? "chess");
  const [invite, setInvite] = useState<{ code: string; id: string; mode: "here" | "online" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [code, setCode] = useState("");
  const [waiting, setWaiting] = useState<Record<string, number>>({});
  const [peopleOpen, setPeopleOpen] = useState(false);
  const people = usePeople();

  // Reflected with replaceState rather than a route change: the shelf is one
  // screen, and pushing history for every spine would bury the way back out.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("game") === selected) return;
    url.searchParams.set("game", selected);
    window.history.replaceState(null, "", url);
  }, [selected]);

  // Someone arriving on a link, or pressing back, should land on that game.
  useEffect(() => {
    const onPop = (): void => {
      const asked = new URLSearchParams(window.location.search).get("game");
      if (asked && games.some((g) => g.id === asked)) setSelected(asked);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [games]);

  useEffect(() => {
    // One sink, added once: the console in development, the endpoint in
    // production. Nothing in the game ever waits on it.
    const off = addAnalyticsSink((event) => {
      if (process.env.NODE_ENV !== "production") {
        console.debug("[gambit]", event.name, event);
        return;
      }
      void fetch("/api/analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
        keepalive: true
      }).catch(() => undefined);
    });
    return off;
  }, []);

  useEffect(() => {
    // Mint an identity on first visit so the first tap is already seated.
    void fetch("/api/me").catch(() => undefined);

    // Who is waiting, refreshed while the shelf is open.
    const poll = () =>
      void fetch("/api/match")
        .then((r) => r.json())
        .then((body: { waiting?: Record<string, number> }) => setWaiting(body.waiting ?? {}))
        .catch(() => undefined);
    poll();
    const timer = setInterval(poll, 8000);
    return () => clearInterval(timer);
  }, []);

  async function quickMatch(gameId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId })
      });
      const body = (await res.json()) as {
        room?: { code: string };
        waitingFor?: number;
        error?: { message: string };
      };
      if (!res.ok || !body.room) throw new Error(body.error?.message ?? "No table free just now.");
      track({ name: "room_created", gameId, mode: "quick" });
      router.push(`/r/${body.room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No table free just now.");
    } finally {
      setBusy(false);
    }
  }

  async function createRoom(gameId: string, mode: "here" | "online") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId, passAndPlay: false })
      });
      const body = (await res.json()) as {
        room?: { id: string; code: string };
        error?: { message: string };
      };
      if (!res.ok || !body.room) throw new Error(body.error?.message ?? "Couldn't open a table.");
      track({ name: "room_created", gameId, mode });
      setInvite({ code: body.room.code, id: body.room.id, mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open a table.");
    } finally {
      setBusy(false);
    }
  }

  async function joinByCode() {
    const clean = code.trim().toUpperCase();
    if (clean.length < 6) return setError("Room codes are six characters.");
    const res = await fetch(`/api/code/${clean}`);
    if (!res.ok) return setError("No table with that code.");
    router.push(`/r/${clean}`);
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 18px 64px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 14,
          marginBottom: 22
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo size={34} />
          <div>
            <div style={{ fontSize: 28, letterSpacing: 6, fontWeight: 700, lineHeight: 1 }}>
              {BRAND.toUpperCase()}
            </div>
            <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--mut)", fontVariant: "small-caps" }}>
              {TAGLINE}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            className="gambit-mini"
            aria-label="You and your friends"
            onClick={() => setPeopleOpen((s) => !s)}
            style={
              (people.data?.requests.length ?? 0) + (people.data?.invites.length ?? 0) > 0
                ? { borderColor: "var(--accent)", color: "var(--accent)" }
                : undefined
            }
          >
            {people.data?.me.avatar ?? "🙂"}
            {(people.data?.requests.length ?? 0) + (people.data?.invites.length ?? 0) > 0 &&
              ` ${(people.data?.requests.length ?? 0) + (people.data?.invites.length ?? 0)}`}
          </button>
          <ThemePicker />
          <button
            className="gambit-mini"
            aria-label="Sound settings"
            onClick={() => setSettingsOpen((s) => !s)}
          >
            {settings.ui || settings.foley || settings.music ? "🔊" : "🔇"}
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div style={{ marginBottom: 18, display: "grid", gap: 12 }}>
          <SoundPanel />
          <Button variant="ghost" onClick={() => update({ music: !settings.music })}>
            {settings.music ? "Stop the music" : "Put some music on"}
          </Button>
        </div>
      )}

      {peopleOpen && (
        <div style={{ marginBottom: 18 }}>
          <People
            data={people.data}
            act={people.act}
            onError={setError}
            onJoin={(joinCode) => router.push(`/r/${joinCode}`)}
          />
        </div>
      )}

      <Shelf
        games={games}
        selectedId={selected}
        onSelect={setSelected}
        onPlayHere={(id) => void createRoom(id, "here")}
        onPlayOnline={(id) => void createRoom(id, "online")}
        onTutorial={(id) => router.push(`/learn/${id}`)}
        onQuickMatch={(id) => void quickMatch(id)}
        waiting={waiting}
      />

      <Panel style={{ marginTop: 28, padding: 18, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <SmallCaps style={{ margin: 0 }}>join a table</SmallCaps>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && void joinByCode()}
          placeholder="ROOM CODE"
          aria-label="Room code"
          maxLength={7}
          style={{
            background: "var(--panel2)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            borderRadius: 8,
            padding: "10px 14px",
            letterSpacing: 4,
            fontFamily: "inherit",
            fontSize: 16,
            width: 170
          }}
        />
        <Button variant="ghost" onClick={() => void joinByCode()}>
          Sit down
        </Button>
      </Panel>

      {invite && (
        <InviteSheet
          code={invite.code}
          url={`${typeof location !== "undefined" ? location.origin : ""}/r/${invite.code}`}
          gameName={games.find((g) => g.id === selected)?.name ?? "Gambit"}
          mode={invite.mode}
          onClose={() => setInvite(null)}
          onEnter={() => router.push(`/r/${invite.code}`)}
        />
      )}

      {/* Quietly placed, and quietly worded: a newcomer who recognises a genre
          finds their way in faster, and everybody else never has to look. */}
      <footer
        style={{
          marginTop: 30,
          display: "flex",
          gap: 16,
          justifyContent: "center",
          fontSize: 12.5,
          color: "var(--mut)"
        }}
      >
        <a href="/compare" style={{ color: "inherit" }}>
          If you already know these games
        </a>
        <a href="/learn" style={{ color: "inherit" }}>
          Learn one in two minutes
        </a>
      </footer>

      <Toast message={error} onDone={() => setError(null)} />
    </main>
  );
}
