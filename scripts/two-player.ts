/**
 * Two people, two browsers, one table — against a real deployment.
 *
 *   pnpm two-player                                  # a local dev server
 *   SMOKE_BASE=https://…vercel.app pnpm two-player   # the real thing
 *
 * Everything else in this repository tests the platform from the inside, with
 * one process and one store. This tests it the way it is actually used: one
 * person opens a table, another arrives on the link with no shared state
 * whatsoever, and they play. That is the path that was broken in production
 * while every check was green — rooms were written to Postgres and then looked
 * for somewhere else, so an invite link never once resolved.
 *
 * Each "player" is a separate cookie jar, which is as close to a separate
 * device as an HTTP client gets.
 */

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3211";

const checks: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** One player: their own cookies, and nothing else shared. */
class Player {
  private cookies = new Map<string, string>();
  constructor(readonly label: string) {}

  private header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private remember(res: Response): void {
    // A player who forgets their identity between requests is a new player.
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      if (name) this.cookies.set(name.trim(), rest.join("="));
    }
  }

  async fetch(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(this.cookies.size ? { cookie: this.header() } : {}),
        ...(init?.headers ?? {})
      }
    });
    this.remember(res);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* a page, not an endpoint */
    }
    return { status: res.status, body };
  }
}

async function main(): Promise<void> {
  console.log(`two players against ${BASE}${process.env.SMOKE_GAME ? ` · ${process.env.SMOKE_GAME}` : ""}\n`);

  const host = new Player("host");
  const guest = new Player("guest");

  /* ---- the host opens a table ---- */
  const gameId = process.env.SMOKE_GAME ?? "chess";
  const opened = await host.fetch("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ gameId })
  });
  const room = opened.body?.room as { id: string; code: string } | undefined;
  check("the host opens a table", Boolean(room), room?.code);
  if (!room) return finish();

  /* ---- the guest arrives on the link, sharing nothing ---- */
  const resolved = await guest.fetch(`/api/code/${room.code}`);
  check(
    "the code resolves for somebody who has never been here",
    resolved.status === 200 && resolved.body?.roomId === room.id,
    resolved.status === 200 ? undefined : JSON.stringify(resolved.body)
  );

  const page = await guest.fetch(`/r/${room.code}`);
  check("and the table's page answers", page.status === 200, `HTTP ${page.status}`);

  /* ---- the guest sits down ---- */
  const joined = await guest.fetch(`/api/rooms/${room.id}`);
  check("the guest is seated", joined.status === 200, `HTTP ${joined.status}`);
  const guestSeat = joined.body?.seat;
  check("with a seat of their own", guestSeat !== null && guestSeat !== undefined, `seat ${guestSeat}`);

  const hostView = await host.fetch(`/api/rooms/${room.id}`);
  const bothSeated = (hostView.body?.room?.players ?? []).filter(
    (p: { seat: number | null }) => p.seat !== null
  ).length;
  check("and the host can see them arrive", bothSeated === 2, `${bothSeated} seated`);

  /* ---- they play ---- */
  // A table does not deal until everybody at it says they are ready, which is
  // the same thing the lobby's button does.
  for (const [who, label] of [[host, "host"], [guest, "guest"]] as const) {
    const ready = await who.fetch(`/api/rooms/${room.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "ready", ready: true })
    });
    check(`the ${label} says they are ready`, ready.status === 200, `HTTP ${ready.status}`);
  }

  // Games with a minimum above two need the empty chairs filled before they
  // will deal; a bot is what a real host would put there too.
  let started = await host.fetch(`/api/rooms/${room.id}/action`, {
    method: "POST",
    body: JSON.stringify({ action: "start" })
  });
  if (started.status !== 200) {
    await host.fetch(`/api/rooms/${room.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "fill" })
    });
    started = await host.fetch(`/api/rooms/${room.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "start" })
    });
  }
  check("the host deals", started.status === 200, `HTTP ${started.status}`);

  const afterStart = await host.fetch(`/api/rooms/${room.id}`);
  const mover = afterStart.body?.current?.[0];
  const first = afterStart.body?.legal?.[0];
  check("there is a legal move to make", Boolean(first), first ? JSON.stringify(first).slice(0, 60) : "none");
  if (!first) return finish();

  const who = afterStart.body?.seat === mover ? host : guest;
  const played = await who.fetch(`/api/rooms/${room.id}/moves`, {
    method: "POST",
    body: JSON.stringify({
      move: first,
      idempotencyKey: "smoke-1",
      clientVersion: afterStart.body?.version
    })
  });
  check("the player to move can move", played.status === 200, `HTTP ${played.status}`);

  /* ---- the other player sees it ---- */
  const other = who === host ? guest : host;
  const seen = await other.fetch(`/api/rooms/${room.id}`);
  check(
    "the other player sees the move",
    (seen.body?.version ?? 0) > (afterStart.body?.version ?? 0),
    `version ${afterStart.body?.version} → ${seen.body?.version}`
  );

  /* ---- and the same move twice is still one move ---- */
  const again = await who.fetch(`/api/rooms/${room.id}/moves`, {
    method: "POST",
    body: JSON.stringify({
      move: first,
      idempotencyKey: "smoke-1",
      clientVersion: afterStart.body?.version
    })
  });
  const after = await other.fetch(`/api/rooms/${room.id}`);
  check(
    "a repeated move is not played twice",
    again.status === 200 && after.body?.version === seen.body?.version,
    `version ${seen.body?.version} → ${after.body?.version}`
  );

  finish();
}

function finish(): void {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
