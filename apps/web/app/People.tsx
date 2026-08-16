"use client";
/**
 * You, and the people you play with.
 *
 * A profile here is a name, an emoji and a six-character code you can read out
 * across a room — no email, no photograph, nothing to moderate. Friends are for
 * inviting; blocking is for not being at the same table, and it is quiet: the
 * person blocked is never told.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Panel, SmallCaps, useSfx } from "@gambit/ui";

export interface PersonProfile {
  playerId: string;
  name: string;
  avatar: string;
  friendCode: string;
}

export interface SocialSnapshot {
  me: PersonProfile;
  avatars: string[];
  friends: PersonProfile[];
  requests: { from: PersonProfile; at: number }[];
  sent: PersonProfile[];
  blocked: PersonProfile[];
  recent: { playerId: string; name: string; gameId: string; at: number }[];
  invites: { from: string; code: string; gameId: string; at: number; fromProfile: PersonProfile }[];
}

export function usePeople() {
  const [data, setData] = useState<SocialSnapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/social");
      if (res.ok) setData((await res.json()) as SocialSnapshot);
    } catch {
      /* offline; the panel simply shows what it had */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = useCallback(
    async (body: Record<string, unknown>): Promise<string | null> => {
      const res = await fetch("/api/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await res.json()) as { error?: { message: string } };
      await refresh();
      return res.ok ? null : (payload.error?.message ?? "That didn't work.");
    },
    [refresh]
  );

  return { data, refresh, act };
}

export function People({
  data,
  act,
  onError,
  onJoin
}: {
  data: SocialSnapshot | null;
  act(body: Record<string, unknown>): Promise<string | null>;
  onError(message: string): void;
  onJoin(code: string): void;
}) {
  const sfx = useSfx();
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  if (!data) return null;

  const run = async (body: Record<string, unknown>) => {
    const error = await act(body);
    if (error) onError(error);
    else sfx("tap");
  };

  const chip = (person: PersonProfile) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 18 }}>{person.avatar}</span>
      {person.name}
    </span>
  );

  return (
    <Panel style={{ padding: 18, display: "grid", gap: 16 }}>
      <SmallCaps>you</SmallCaps>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 30 }}>{data.me.avatar}</span>
        <input
          value={data.me.name}
          onChange={(e) => void run({ action: "profile", name: e.target.value })}
          maxLength={24}
          aria-label="Your display name"
          style={{
            background: "var(--panel2)",
            border: "1px solid var(--line)",
            color: "var(--ink)",
            borderRadius: 8,
            padding: "9px 12px",
            fontFamily: "inherit",
            fontSize: 15,
            flex: "1 1 160px"
          }}
        />
        <button
          className="gambit-mini"
          title="Your friend code — read it out, and they can add you"
          onClick={() => {
            void navigator.clipboard?.writeText(data.me.friendCode).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "copied" : data.me.friendCode}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {data.avatars.map((emoji) => (
          <button
            key={emoji}
            aria-label={`Use ${emoji} as your avatar`}
            onClick={() => void run({ action: "profile", avatar: emoji })}
            style={{
              fontSize: 20,
              width: 38,
              height: 38,
              borderRadius: 10,
              cursor: "pointer",
              background: data.me.avatar === emoji ? "var(--panel2)" : "transparent",
              border: `1px solid ${data.me.avatar === emoji ? "var(--accent)" : "var(--line)"}`
            }}
          >
            {emoji}
          </button>
        ))}
      </div>

      {data.invites.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <SmallCaps>you've been invited</SmallCaps>
          {data.invites.map((invite) => (
            <div key={invite.code} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14 }}>
                {chip(invite.fromProfile)} · {invite.gameId}
              </span>
              <button
                className="gambit-mini"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                onClick={() => onJoin(invite.code)}
              >
                Sit down
              </button>
            </div>
          ))}
        </div>
      )}

      {data.requests.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <SmallCaps>wants to be friends</SmallCaps>
          {data.requests.map((request) => (
            <div key={request.from.playerId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 14 }}>{chip(request.from)}</span>
              <button
                className="gambit-mini"
                onClick={() => void run({ action: "answer", playerId: request.from.playerId, accept: true })}
              >
                Accept
              </button>
              <button
                className="gambit-mini"
                onClick={() => void run({ action: "answer", playerId: request.from.playerId, accept: false })}
              >
                No
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <SmallCaps>friends</SmallCaps>
        {data.friends.length === 0 && (
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            Nobody yet. Swap friend codes, or add someone you've just played.
          </span>
        )}
        {data.friends.map((friend) => (
          <div key={friend.playerId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1, fontSize: 14 }}>{chip(friend)}</span>
            <button className="gambit-mini" onClick={() => void run({ action: "remove", playerId: friend.playerId })}>
              Remove
            </button>
            <button className="gambit-mini" onClick={() => void run({ action: "block", playerId: friend.playerId })}>
              Block
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || code.length < 6) return;
              void run({ action: "add", friendCode: code });
              setCode("");
            }}
            placeholder="FRIEND CODE"
            aria-label="Add a friend by their code"
            maxLength={7}
            style={{
              background: "var(--panel2)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              borderRadius: 8,
              padding: "8px 12px",
              letterSpacing: 3,
              fontFamily: "inherit",
              fontSize: 14,
              width: 160
            }}
          />
          <button
            className="gambit-mini"
            disabled={code.length < 6}
            onClick={() => {
              void run({ action: "add", friendCode: code });
              setCode("");
            }}
          >
            Add
          </button>
        </div>
        {data.sent.length > 0 && (
          <span style={{ fontSize: 12, color: "var(--mut)" }}>
            waiting on {data.sent.map((p) => p.name).join(", ")}
          </span>
        )}
      </div>

      {data.recent.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <SmallCaps>played with recently</SmallCaps>
          {data.recent.slice(0, 6).map((person) => (
            <div key={person.playerId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 14 }}>
                {person.name} <span style={{ color: "var(--mut)" }}>· {person.gameId}</span>
              </span>
              <button className="gambit-mini" onClick={() => void run({ action: "add-id", playerId: person.playerId })}>
                Add friend
              </button>
              <button className="gambit-mini" onClick={() => void run({ action: "block", playerId: person.playerId })}>
                Block
              </button>
            </div>
          ))}
        </div>
      )}

      {data.blocked.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <SmallCaps>blocked</SmallCaps>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>
            You won't be seated together, and they are never told.
          </span>
          {data.blocked.map((person) => (
            <div key={person.playerId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 14 }}>{chip(person)}</span>
              <button className="gambit-mini" onClick={() => void run({ action: "unblock", playerId: person.playerId })}>
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
