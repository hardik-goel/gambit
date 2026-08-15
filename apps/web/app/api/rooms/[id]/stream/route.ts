import { clientSnapshot } from "@gambit/core";
import type { ServerMessage } from "@gambit/core";
import { readIdentity } from "@/lib/server/identity";
import { deps, store, subscribe } from "@/lib/server/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The downstream half of the transport: one SSE stream per client, carrying
 * only what that seat is allowed to see.
 *
 * On connect it replays everything after `since`, so a client that dropped out
 * on the train comes back exactly where it was rather than starting over.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? 0);
  const me = await readIdentity();
  const playerId = me?.playerId ?? url.searchParams.get("playerId") ?? "spectator";

  const room = await store.getRoom(id);
  if (!room) return new Response("no such table", { status: 404 });

  const seat = room.players.find((p) => p.playerId === playerId)?.seat ?? null;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (msg: ServerMessage) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
      };

      const unsubscribe = subscribe({ roomId: id, playerId, seat, send: write });

      // Catch up first, then go live.
      const snap = await clientSnapshot(deps, id, playerId, since);
      if (snap) {
        write({ type: "hello", roomId: id, version: snap.version, seq: snap.seq });
        write({ type: "room", room: snap.room });
        if (snap.view !== null) {
          write({
            type: "delta",
            version: snap.version,
            seq: snap.seq,
            events: snap.history,
            view: snap.view,
            current: snap.current,
            legal: snap.legal,
            terminal: snap.terminal
          });
        }
      }

      // Keep-alive: proxies drop idle streams, and the client uses this to
      // colour its connection dot honestly.
      const beat = setInterval(() => write({ type: "ping", at: Date.now() }), 20_000);

      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(beat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer SSE into uselessness without this.
      "x-accel-buffering": "no"
    }
  });
}
