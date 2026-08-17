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

  /**
   * A table against the machine, in one press.
   *
   * Everything needed was already there — open a room, fill the empty chairs
   * with bots, say you are ready, deal — but only as four separate things a
   * player had to know to do in order, from inside a lobby they had to find
   * first. Somebody who wants a game right now should not have to hold a
   * meeting to get one.
   */
  async function playComputer(gameId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const made = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId, passAndPlay: false })
      });
      const body = (await made.json()) as {
        room?: { id: string; code: string };
        error?: { message: string };
      };
      if (!made.ok || !body.room) throw new Error(body.error?.message ?? "Couldn't open a table.");

      const act = (action: Record<string, unknown>) =>
        fetch(`/api/rooms/${body.room!.id}/action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(action)
        });

      await act({ action: "fill" });
      await act({ action: "ready", ready: true });
      const dealt = await act({ action: "start" });
      if (!dealt.ok) {
        const why = (await dealt.json()) as { error?: { message: string } };
        throw new Error(why.error?.message ?? "Couldn't deal.");
      }

      track({ name: "room_created", gameId, mode: "computer" });
      router.push(`/r/${body.room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start a game.");
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
          {/* Music plays from the moment somebody opens Gambit, so stopping it
              has to be one press from wherever they are — not three, inside a
              panel they have to know exists. */}
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
        onPlayComputer={(id) => void playComputer(id)}
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
          display: "grid",
          gap: 8,
          justifyItems: "center",
          textAlign: "center",
          fontSize: 12.5,
          color: "var(--mut)"
        }}
      >
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
          <a href="/compare" style={{ color: "inherit" }}>
            Which game is which
          </a>
          <a href="/learn" style={{ color: "inherit" }}>
            Learn one in two minutes
          </a>
        </div>
        {/* The line that makes naming another game a description rather than a
            claim. It costs a sentence and it belongs wherever those names are
            shown, which is now the shelf. */}
        <p style={{ margin: 0, fontSize: 11.5, opacity: 0.75, maxWidth: 620, lineHeight: 1.6 }}>
          Every game here is our own — our rules, our maps, our art. Titles named as
          &ldquo;our take on&rdquo; are the trade marks of their respective owners, used only to
          describe what ours resemble. Gambit is not affiliated with, endorsed by or sponsored by
          any of them.
        </p>
      </footer>

      <Toast message={error} onDone={() => setError(null)} />
    </main>
  );
}
