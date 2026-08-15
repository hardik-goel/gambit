/**
 * End-to-end check against a real server.
 *
 * Two independent clients (separate cookie jars — genuinely two browsers as far
 * as the server is concerned) open a table, take seats, stream deltas over SSE,
 * play a game to checkmate, and one of them drops out mid-game and resumes from
 * its last sequence number.
 *
 *   pnpm build && pnpm exec tsx scripts/e2e.ts
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3111);
const BASE = `http://127.0.0.1:${PORT}`;

class Client {
  cookie = "";
  name = "";
  playerId = "";

  constructor(readonly label: string) {}

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(init.headers ?? {})
      }
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) {
      const jar = new Map(this.cookie.split("; ").filter(Boolean).map((c) => [c.split("=")[0]!, c] as const));
      for (const raw of set) {
        const pair = raw.split(";")[0]!;
        jar.set(pair.split("=")[0]!, pair);
      }
      this.cookie = [...jar.values()].join("; ");
    }
    return res;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetch(path, init);
    const body = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(`${this.label} ${path}: ${body.error?.message ?? res.status}`);
    return body;
  }

  async identify(): Promise<void> {
    const me = await this.json<{ playerId: string; name: string }>("/api/me");
    this.playerId = me.playerId;
    this.name = me.name;
  }

  /** Opens the SSE stream and collects messages until stopped. */
  stream(roomId: string, since = 0) {
    const controller = new AbortController();
    const messages: Record<string, unknown>[] = [];
    const done = (async () => {
      const res = await fetch(`${BASE}/api/rooms/${roomId}/stream?since=${since}`, {
        headers: { cookie: this.cookie, accept: "text/event-stream" },
        signal: controller.signal
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let i;
          while ((i = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (line) messages.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
          }
        }
      } catch {
        /* aborted */
      }
    })();
    return { messages, stop: () => { controller.abort(); return done; } };
  }
}

const sq = (name: string): number => {
  const f = "abcdefgh".indexOf(name[0]!);
  const r = Number(name[1]) - 1;
  return (7 - r) * 8 + f;
};
const move = (from: string, to: string) => ({ kind: "move", from: sq(from), to: sq(to) });

const checks: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: new URL("../apps/web", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (d: Buffer) => process.env.VERBOSE && process.stdout.write(d));
  server.stderr.on("data", (d: Buffer) => process.stderr.write(d));

  try {
    // Wait for the server to answer.
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`${BASE}/api/me`);
        if (res.ok) break;
      } catch {
        /* not up yet */
      }
      await sleep(500);
      if (i === 59) throw new Error("server never came up");
    }

    const alice = new Client("alice");
    const bob = new Client("bob");
    await alice.identify();
    await bob.identify();
    check("two clients get distinct identities", alice.playerId !== bob.playerId);

    const { room } = await alice.json<{ room: { id: string; code: string } }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ gameId: "chess", config: { clock: "none" } })
    });
    check("host opens a table", Boolean(room.code), `code ${room.code}`);

    // Bob follows the share link: GET on the room both joins and snapshots.
    const bobJoin = await bob.json<{ seat: number | null }>(`/api/rooms/${room.id}`);
    check("second player is seated by following the link", bobJoin.seat === 1, `seat ${bobJoin.seat}`);

    const aliceStream = alice.stream(room.id);
    const bobStream = bob.stream(room.id);
    await sleep(400);

    for (const c of [alice, bob]) {
      await c.json(`/api/rooms/${room.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "ready", ready: true })
      });
    }
    await alice.json(`/api/rooms/${room.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "start" })
    });
    await sleep(300);

    const firstDelta = aliceStream.messages.find((m) => m.type === "delta");
    check("white receives a redacted view over SSE", Boolean(firstDelta));
    const whiteLegal = (firstDelta?.legal as unknown[])?.length ?? 0;
    const blackLegal =
      (bobStream.messages.filter((m) => m.type === "delta").at(-1)?.legal as unknown[])?.length ?? -1;
    check(
      "white is given legal moves, black is not",
      whiteLegal >= 20 && blackLegal === 0,
      `white ${whiteLegal}, black ${blackLegal}`
    );

    const line: [Client, string, string][] = [
      [alice, "e2", "e4"], [bob, "e7", "e5"],
      [alice, "f1", "c4"], [bob, "b8", "c6"],
      [alice, "d1", "h5"], [bob, "g8", "f6"]
    ];
    for (const [who, from, to] of line) {
      await who.json(`/api/rooms/${room.id}/moves`, {
        method: "POST",
        body: JSON.stringify({ move: move(from, to), idempotencyKey: `${who.label}-${from}${to}` })
      });
    }
    await sleep(250);

    // Bob's connection drops mid-game.
    const lastSeq = Number(bobStream.messages.filter((m) => "seq" in m).at(-1)?.seq ?? 0);
    await bobStream.stop();

    await alice.json(`/api/rooms/${room.id}/moves`, {
      method: "POST",
      body: JSON.stringify({ move: move("h5", "f7"), idempotencyKey: "mate" })
    });
    await sleep(250);

    // ...and comes back, resuming from where it left off.
    const bobAgain = bob.stream(room.id, lastSeq);
    await sleep(600);
    const resumed = bobAgain.messages.find((m) => m.type === "delta");
    check("a reconnecting client is caught up from its last sequence", Boolean(resumed));
    check("the reconnected client sees the finish", resumed?.terminal === true);

    const finalSnap = await bob.json<{ terminal: boolean; scores?: { seat: number; won: boolean }[] }>(
      `/api/rooms/${room.id}`
    );
    check("the game is over", finalSnap.terminal === true);
    check("white won the scholar's mate", finalSnap.scores?.find((s) => s.won)?.seat === 0);

    // A retried move must not be applied twice.
    const retry = await alice.fetch(`/api/rooms/${room.id}/moves`, {
      method: "POST",
      body: JSON.stringify({ move: move("h5", "f7"), idempotencyKey: "mate" })
    });
    check("a retried move is idempotent", retry.ok);

    const replay = await bob.json<{ frames: unknown[] }>(`/api/rooms/${room.id}/replay`);
    check("the whole game replays from its log", replay.frames.length === 8, `${replay.frames.length} frames`);

    await aliceStream.stop();
    await bobAgain.stop();
  } finally {
    server.kill("SIGTERM");
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
