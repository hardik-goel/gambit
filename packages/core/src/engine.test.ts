import { beforeEach, describe, expect, it } from "vitest";
import chess, { squareIndex, type ChessMove, type ChessView } from "@gambit/game-chess";
import type { SeatId } from "@gambit/sdk";
import { MemoryRoomStore } from "./stores/memory";
import { clientSnapshot, driveBots, startGame, submitMove, takeOverIdleSeat, type EngineDeps } from "./engine";
import { addBot, createRoom, fillWithBots, joinRoom, setReady, takeSeat } from "./rooms";
import type { ServerMessage } from "./transport";
import { TableClient } from "./client";
import type { GameTransport } from "./transport";

/** A broadcaster that records what each seat was told, so we can audit it. */
function recorder() {
  const seatLog = new Map<SeatId, ServerMessage[]>();
  const spectator: ServerMessage[] = [];
  const room: ServerMessage[] = [];
  return {
    seatLog,
    spectator,
    room,
    broadcast: {
      toSeat(_r: string, seat: SeatId, msg: ServerMessage) {
        const list = seatLog.get(seat) ?? [];
        list.push(msg);
        seatLog.set(seat, list);
      },
      toSpectators(_r: string, msg: ServerMessage) {
        spectator.push(msg);
      },
      toRoom(_r: string, msg: ServerMessage) {
        room.push(msg);
      }
    }
  };
}

let deps: EngineDeps;
let rec: ReturnType<typeof recorder>;

beforeEach(() => {
  rec = recorder();
  deps = { store: new MemoryRoomStore(), catalog: { chess }, broadcast: rec.broadcast };
});

async function twoPlayerTable() {
  const created = await createRoom(deps, {
    gameId: "chess",
    host: { playerId: "alice", name: "Alice" },
    config: { clock: "none" }
  });
  if (!created.ok) throw new Error(created.error.message);
  const roomId = created.value.id;
  await joinRoom(deps, roomId, { playerId: "bob", name: "Bob" });
  await takeSeat(deps, roomId, "bob", 1);
  await setReady(deps, roomId, "alice", true);
  await setReady(deps, roomId, "bob", true);
  return { roomId, code: created.value.code };
}

const move = (from: string, to: string): ChessMove => ({
  kind: "move",
  from: squareIndex(from),
  to: squareIndex(to)
});

describe("the move pipeline", () => {
  it("seats two players, starts, and plays a game to a finish", async () => {
    const { roomId } = await twoPlayerTable();
    const started = await startGame(deps, roomId, "alice");
    expect(started.ok).toBe(true);

    const line: [string, string, string][] = [
      ["alice", "e2", "e4"], ["bob", "e7", "e5"],
      ["alice", "f1", "c4"], ["bob", "b8", "c6"],
      ["alice", "d1", "h5"], ["bob", "g8", "f6"],
      ["alice", "h5", "f7"]
    ];
    for (const [who, from, to] of line) {
      const res = await submitMove(deps, {
        roomId,
        playerId: who,
        move: move(from, to),
        idempotencyKey: `${who}-${from}${to}`
      });
      expect(res.ok, `${who} ${from}${to}`).toBe(true);
    }

    const snap = await clientSnapshot(deps, roomId, "alice");
    expect(snap?.terminal).toBe(true);
    expect(snap?.scores?.find((s) => s.won)?.seat).toBe(0);

    const room = await deps.store.getRoom(roomId);
    expect(room?.status).toBe("finished");
    expect(rec.room.some((m) => m.type === "finished")).toBe(true);
  });

  it("refuses a move from the seat that isn't to play", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");
    const res = await submitMove(deps, {
      roomId,
      playerId: "bob",
      move: move("e7", "e5"),
      idempotencyKey: "early"
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not-your-turn");
  });

  it("explains an illegal move rather than swallowing it", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");
    const res = await submitMove(deps, {
      roomId,
      playerId: "alice",
      move: move("e1", "e4"),
      idempotencyKey: "silly"
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/king|reach|piece/i);
  });

  it("treats a retried move as the same move, not a second one", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");
    const key = "retry-me";
    const first = await submitMove(deps, { roomId, playerId: "alice", move: move("e2", "e4"), idempotencyKey: key });
    const second = await submitMove(deps, { roomId, playerId: "alice", move: move("e2", "e4"), idempotencyKey: key });
    expect(first.ok && second.ok).toBe(true);
    const moves = await deps.store.getMoves(roomId);
    expect(moves).toHaveLength(1);
  });

  it("stamps every move with the server's clock so replays stay exact", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");
    await submitMove(deps, { roomId, playerId: "alice", move: move("e2", "e4"), idempotencyKey: "k" });
    const [stored] = await deps.store.getMoves(roomId);
    expect((stored?.move as { __at?: number }).__at).toBeTypeOf("number");
  });

  it("gives each seat its own view and its own legal moves", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");

    const white = await clientSnapshot(deps, roomId, "alice");
    const black = await clientSnapshot(deps, roomId, "bob");
    expect((white?.view as ChessView).colors[0]).toBe("w");
    expect(white?.legal.length).toBeGreaterThan(0);
    // Black is not to move, so black has nothing to play — and is never told
    // what White is considering.
    expect(black?.legal).toHaveLength(0);

    const spectator = await clientSnapshot(deps, roomId, "nobody");
    expect(spectator?.seat).toBeNull();
    expect(spectator?.legal).toHaveLength(0);
  });

  it("catches a reconnecting client up from its last sequence number", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");
    const before = await clientSnapshot(deps, roomId, "bob");
    const seqAtDrop = before!.seq;

    await submitMove(deps, { roomId, playerId: "alice", move: move("e2", "e4"), idempotencyKey: "a" });
    await submitMove(deps, { roomId, playerId: "bob", move: move("e7", "e5"), idempotencyKey: "b" });

    // Bob's phone comes back: everything since the drop, nothing before it.
    const resumed = await clientSnapshot(deps, roomId, "bob", seqAtDrop);
    expect(resumed!.seq).toBeGreaterThan(seqAtDrop);
    expect(resumed!.history.length).toBe(2);
    expect((resumed!.view as ChessView).board[squareIndex("e4")]).toBe("P");
    expect(resumed!.current).toEqual([0]);
  });

  it("plays out bot seats without waiting for a human", async () => {
    const created = await createRoom(deps, {
      gameId: "chess",
      host: { playerId: "alice", name: "Alice" },
      config: { clock: "none" }
    });
    if (!created.ok) throw new Error("no room");
    const roomId = created.value.id;
    await addBot(deps, roomId, "alice", 1);
    await setReady(deps, roomId, "alice", true);
    await startGame(deps, roomId, "alice");

    await submitMove(deps, { roomId, playerId: "alice", move: move("e2", "e4"), idempotencyKey: "1" });
    await driveBots(deps, roomId);

    const snap = await clientSnapshot(deps, roomId, "alice");
    // The bot answered, so it is Alice's move again.
    expect(snap!.current).toEqual([0]);
    expect((snap!.view as ChessView).history.length).toBe(2);
  });

  it("lets a bot cover an abandoned seat, and the human take it back", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");
    await submitMove(deps, { roomId, playerId: "alice", move: move("e2", "e4"), idempotencyKey: "1" });

    // Bob has wandered off; the table doesn't stall.
    const covered = await takeOverIdleSeat(deps, roomId, 1);
    expect(covered.ok).toBe(true);

    // Bob comes back and plays for himself again.
    const back = await submitMove(deps, {
      roomId,
      playerId: "alice",
      move: move("g1", "f3"),
      idempotencyKey: "2"
    });
    expect(back.ok).toBe(true);
  });

  it("fills a table with bots up to the game's minimum", async () => {
    const created = await createRoom(deps, {
      gameId: "chess",
      host: { playerId: "alice", name: "Alice" }
    });
    if (!created.ok) throw new Error("no room");
    const filled = await fillWithBots(deps, created.value.id, "alice");
    expect(filled.ok).toBe(true);
    if (filled.ok) expect(filled.value.players.filter((p) => p.seat !== null)).toHaveLength(2);
  });

  it("won't start a table that is short of players or not ready", async () => {
    const created = await createRoom(deps, {
      gameId: "chess",
      host: { playerId: "alice", name: "Alice" }
    });
    if (!created.ok) throw new Error("no room");
    const short = await startGame(deps, created.value.id, "alice");
    expect(short.ok).toBe(false);

    await joinRoom(deps, created.value.id, { playerId: "bob", name: "Bob" });
    await takeSeat(deps, created.value.id, "bob", 1);
    const notReady = await startGame(deps, created.value.id, "alice");
    expect(notReady.ok).toBe(false);
    if (!notReady.ok) expect(notReady.error.code).toBe("not-ready");

    const notHost = await startGame(deps, created.value.id, "bob");
    expect(notHost.ok).toBe(false);
  });
});

describe("the optimistic client", () => {
  /** A transport that speaks straight to the engine, with a settable delay. */
  function loopback(roomId: string, playerId: string, latencyMs: number): GameTransport {
    return {
      async connect(opts) {
        const seat = opts.seat;
        const sub = (msg: ServerMessage) => opts.onMessage(msg);
        const original = rec.broadcast.toSeat;
        // Tap the recorder: anything sent to our seat is delivered to us.
        rec.broadcast.toSeat = (r: string, s: SeatId, msg: ServerMessage) => {
          original.call(rec.broadcast, r, s, msg);
          if (s === seat) setTimeout(() => sub(msg), latencyMs);
        };
        opts.onStatus("live");
        return { close: () => undefined };
      },
      async send(_room, msg) {
        if (msg.type !== "move") return;
        await new Promise((r) => setTimeout(r, latencyMs));
        const res = await submitMove(deps, {
          roomId,
          playerId,
          move: msg.move,
          idempotencyKey: msg.idempotencyKey
        });
        await new Promise((r) => setTimeout(r, latencyMs));
        if (!res.ok) throw new Error(res.error.message);
      }
    };
  }

  it("shows your own move immediately, long before the server hears about it", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");
    const snap = await clientSnapshot(deps, roomId, "alice");

    // 150ms each way: a bad hotel wifi, or the other side of the country.
    const client = new TableClient({
      def: chess,
      transport: loopback(roomId, "alice", 150),
      roomId,
      playerId: "alice",
      seat: 0,
      initial: { view: snap!.view, legal: snap!.legal, current: snap!.current, version: snap!.version }
    });
    await client.connect();

    const startedAt = performance.now();
    client.play(move("e2", "e4"));
    const elapsed = performance.now() - startedAt;

    // The pawn is already on e4 in the local view, synchronously.
    expect(elapsed).toBeLessThan(16);
    expect((client.state.view as ChessView).board[squareIndex("e4")]).toBe("P");
    expect(client.state.pending).toBe(true);

    // And the server agrees a moment later.
    await new Promise((r) => setTimeout(r, 500));
    expect(client.state.pending).toBe(false);
    const server = await clientSnapshot(deps, roomId, "alice");
    expect((server!.view as ChessView).board[squareIndex("e4")]).toBe("P");
  });

  it("rolls back with a reason when the server refuses", async () => {
    const { roomId } = await twoPlayerTable();
    await startGame(deps, roomId, "alice");
    const snap = await clientSnapshot(deps, roomId, "alice");
    const client = new TableClient({
      def: chess,
      transport: loopback(roomId, "alice", 5),
      roomId,
      playerId: "alice",
      seat: 0,
      initial: { view: snap!.view, legal: snap!.legal, current: snap!.current, version: snap!.version }
    });
    await client.connect();

    // A move the client believes in but the server rejects: the king can't
    // teleport, whatever the client thinks.
    client.play({ kind: "move", from: squareIndex("e1"), to: squareIndex("e4") });
    await new Promise((r) => setTimeout(r, 120));
    expect(client.state.rejection).toBeTruthy();
    expect((client.state.view as ChessView).board[squareIndex("e1")]).toBe("K");
  });
});
