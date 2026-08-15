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

export function Lobby({ games }: { games: ShelfGame[] }) {
  const router = useRouter();
  const { settings, update } = useAudio();
  const [selected, setSelected] = useState(games[0]?.id ?? "chess");
  const [invite, setInvite] = useState<{ code: string; id: string; mode: "here" | "online" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    // Mint an identity on first visit so the first tap is already seated.
    void fetch("/api/me")
      .then((r) => r.json())
      .then((me: { name: string }) => setName(me.name))
      .catch(() => undefined);
  }, []);

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

  async function rename(next: string) {
    setName(next);
    await fetch("/api/me", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: next })
    });
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
          <Panel style={{ padding: 16 }}>
            <SmallCaps>you at the table</SmallCaps>
            <input
              value={name}
              onChange={(e) => void rename(e.target.value)}
              maxLength={24}
              aria-label="Your display name"
              style={{
                marginTop: 8,
                width: "100%",
                background: "var(--panel2)",
                border: "1px solid var(--line)",
                color: "var(--ink)",
                borderRadius: 8,
                padding: "10px 12px",
                fontFamily: "inherit",
                fontSize: 15
              }}
            />
          </Panel>
          <Button variant="ghost" onClick={() => update({ music: !settings.music })}>
            {settings.music ? "Stop the music" : "Put some music on"}
          </Button>
        </div>
      )}

      <Shelf
        games={games}
        selectedId={selected}
        onSelect={setSelected}
        onPlayHere={(id) => void createRoom(id, "here")}
        onPlayOnline={(id) => void createRoom(id, "online")}
        onTutorial={(id) => router.push(`/learn/${id}`)}
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

      <Toast message={error} onDone={() => setError(null)} />
    </main>
  );
}
