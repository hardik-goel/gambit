/**
 * The social layer, driven through the real API by three separate clients.
 *
 * Profiles, friend codes, requests, invites and — the part that reaches into
 * the engine — blocking, which must keep two people off the same table both in
 * quick match and when one of them follows a share link.
 *
 *   pnpm build && pnpm exec tsx scripts/social-e2e.ts
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.PORT ?? 3311);
const BASE = `http://127.0.0.1:${PORT}`;
const jars: Record<string, string> = {};

async function call(who: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(jars[who] ? { cookie: jars[who] } : {}),
      ...(init.headers ?? {})
    }
  });
  // Merge rather than replace: a response that sets one cookie must not drop
  // the others, which is what a browser does and what the server assumes.
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) {
    const jar = new Map((jars[who] ?? "").split("; ").filter(Boolean).map((c) => [c.split("=")[0]!, c] as const));
    for (const raw of set) {
      const pair = raw.split(";")[0]!;
      jar.set(pair.split("=")[0]!, pair);
    }
    jars[who] = [...jar.values()].join("; ");
  }
  return res;
}

const json = async <T>(who: string, path: string, init?: RequestInit): Promise<T> =>
  (await call(who, path, init)) .json() as Promise<T>;

interface Social {
  me: { playerId: string; name: string; avatar: string; friendCode: string };
  friends: { playerId: string; name: string }[];
  requests: { from: { playerId: string; name: string } }[];
  blocked: { playerId: string }[];
  invites: { code: string; gameId: string }[];
  recent: { playerId: string; name: string }[];
}

const checks: { ok: boolean }[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ ok });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

const post = (who: string, body: unknown) =>
  call(who, "/api/social", { method: "POST", body: JSON.stringify(body) });

async function main(): Promise<void> {
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: new URL("../apps/web", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (d: Buffer) => process.env.VERBOSE && process.stdout.write(d));
  server.stderr.on("data", (d: Buffer) => process.stderr.write(d));

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/api/me`)).ok) break;
      } catch {
        /* not up yet */
      }
      await sleep(500);
      if (i === 59) throw new Error("server never came up");
    }

    for (const who of ["ada", "bo", "cy"]) await call(who, "/api/me");
    const ada = await json<Social>("ada", "/api/social");
    const bo = await json<Social>("bo", "/api/social");
    const cy = await json<Social>("cy", "/api/social");

    check(
      "a profile is minted with an emoji and a friend code",
      ada.me.friendCode.length === 6 && [...ada.me.avatar].length === 1,
      `${ada.me.avatar} ${ada.me.friendCode}`
    );
    check("two players get different codes", ada.me.friendCode !== bo.me.friendCode);

    await post("ada", { action: "profile", name: "Ada", avatar: "🦉" });
    const named = await json<Social>("ada", "/api/social");
    check("a profile can be renamed and re-badged", named.me.name === "Ada" && named.me.avatar === "🦉");

    const kept = await (await post("ada", { action: "profile", avatar: "not an emoji" })).json() as { me: Social["me"] };
    check("the avatar slot will not take a second name", kept.me.avatar === "🦉");

    /* ---- friendship ---- */
    await post("ada", { action: "add", friendCode: bo.me.friendCode });
    let boView = await json<Social>("bo", "/api/social");
    check("a friend request arrives", boView.requests.length === 1, boView.requests[0]?.from.name);

    await post("bo", { action: "answer", playerId: ada.me.playerId, accept: true });
    boView = await json<Social>("bo", "/api/social");
    const adaView = await json<Social>("ada", "/api/social");
    check("accepting makes it mutual", boView.friends.length === 1 && adaView.friends.length === 1);

    const badCode = await post("ada", { action: "add", friendCode: "ZZZZZZ" });
    check("an unknown friend code is refused", badCode.status === 404);

    /* ---- invites ---- */
    const { room } = await json<{ room: { id: string; code: string } }>("ada", "/api/rooms", {
      method: "POST",
      body: JSON.stringify({ gameId: "mosaic" })
    });
    await post("ada", { action: "invite", playerId: bo.me.playerId, roomId: room.id });
    boView = await json<Social>("bo", "/api/social");
    check("a friend can be asked to a table", boView.invites.length === 1, boView.invites[0]?.code);

    const outsider = await post("cy", { action: "invite", playerId: bo.me.playerId, roomId: room.id });
    check("somebody not at the table cannot invite to it", outsider.status === 403);

    /* ---- blocking, which reaches into the engine ---- */
    await post("ada", { action: "block", playerId: cy.me.playerId });
    const blockedView = await json<Social>("ada", "/api/social");
    check("the block is recorded", blockedView.blocked.some((b) => b.playerId === cy.me.playerId));

    const followed = await call("cy", `/api/rooms/${room.id}`);
    check("a blocked player cannot follow the share link in", followed.status === 404 || followed.status === 400);

    const boJoins = await call("bo", `/api/rooms/${room.id}`);
    check("everybody else still walks straight in", boJoins.ok);

    // Quick match must not put them together either.
    const adaMatch = await json<{ room: { id: string }; created: boolean }>("ada", "/api/match", {
      method: "POST",
      body: JSON.stringify({ gameId: "facet" })
    });
    const cyMatch = await json<{ room: { id: string }; created: boolean }>("cy", "/api/match", {
      method: "POST",
      body: JSON.stringify({ gameId: "facet" })
    });
    check(
      "quick match opens a second table rather than seating them together",
      cyMatch.created && cyMatch.room.id !== adaMatch.room.id
    );

    const boMatch = await json<{ room: { id: string }; created: boolean }>("bo", "/api/match", {
      method: "POST",
      body: JSON.stringify({ gameId: "facet" })
    });
    check("and an unrelated player still fills an open table", !boMatch.created);

    await post("ada", { action: "unblock", playerId: cy.me.playerId });
    const unblocked = await json<Social>("ada", "/api/social");
    check("unblocking undoes it", unblocked.blocked.length === 0);
  } finally {
    server.kill("SIGTERM");
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exit(1);
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
