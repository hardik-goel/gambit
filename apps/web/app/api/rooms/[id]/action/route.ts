import { NextResponse } from "next/server";
import {
  addBot,
  fillWithBots,
  kick,
  rematch,
  setConfig,
  setGame,
  setReady,
  setTeam,
  startGame,
  takeSeat
} from "@gambit/core";
import type { Room } from "@gambit/core";
import type { Result } from "@gambit/sdk";
import { requireIdentity } from "@/lib/server/identity";
import { deps, setSubscriberSeat } from "@/lib/server/table";
import { watchTable } from "@/lib/server/timeouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action:
    | "seat"
    | "team"
    | "ready"
    | "config"
    | "game"
    | "bot"
    | "fill"
    | "kick"
    | "start"
    | "rematch";
  seat?: number | null;
  team?: string;
  ready?: boolean;
  config?: Record<string, unknown>;
  gameId?: string;
  level?: 1 | 2 | 3;
  target?: number;
  playerId?: string;
};

/** Every lobby control in one place; each maps to one core operation. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await requireIdentity();
  const body = (await req.json()) as Body;

  let res: Result<Room> | Result<{ version: number }>;
  switch (body.action) {
    case "seat":
      res = await takeSeat(deps, id, me.playerId, body.seat ?? null);
      if (res.ok) setSubscriberSeat(me.playerId, id, body.seat ?? null);
      break;
    case "team":
      res = await setTeam(deps, id, me.playerId, body.team);
      break;
    case "ready":
      res = await setReady(deps, id, me.playerId, body.ready ?? true);
      break;
    case "config":
      res = await setConfig(deps, id, me.playerId, body.config ?? {});
      break;
    case "game":
      res = await setGame(deps, id, me.playerId, body.gameId ?? "");
      break;
    case "bot":
      res = await addBot(deps, id, me.playerId, body.level ?? 2);
      break;
    case "fill":
      res = await fillWithBots(deps, id, me.playerId, body.target, body.level ?? 2);
      break;
    case "kick":
      res = await kick(deps, id, me.playerId, body.playerId ?? "");
      break;
    case "start":
      res = await startGame(deps, id, me.playerId);
      break;
    case "rematch":
      res = await rematch(deps, id, me.playerId);
      break;
    default:
      return NextResponse.json(
        { error: { code: "unknown-action", message: "That control doesn't exist." } },
        { status: 400 }
      );
  }

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  // Starting a game puts the first seat on the clock.
  if (body.action === "start" || body.action === "rematch") void watchTable(id);
  return NextResponse.json({ ok: true, value: res.value });
}
