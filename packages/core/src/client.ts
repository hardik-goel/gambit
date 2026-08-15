/**
 * The client table.
 *
 * Everything here exists to make a move feel like it happened before the
 * network was ever involved:
 *
 *   input → predict locally (<16ms, animation starts) → send → reconcile
 *
 * A rejection is rare and honest: the view snaps back and the game's own
 * one-line reason appears. Nothing here is game-specific.
 */
import type { AnyGameDefinition, GameEvent, SeatId } from "@gambit/sdk";
import type { Room } from "./room";
import type {
  ClientMessage,
  ConnectionStatus,
  GameTransport,
  ServerMessage,
  TransportHandle
} from "./transport";

export interface TableState {
  room: Room | null;
  seat: SeatId | null;
  view: unknown;
  legal: unknown[];
  current: SeatId[];
  version: number;
  seq: number;
  terminal: boolean;
  scores: unknown;
  /** Newest last; the board reads this for choreography, the ticker for text. */
  events: GameEvent[];
  status: ConnectionStatus;
  /** True while a local move is unacknowledged. */
  pending: boolean;
  /** Set for a few seconds after a rejected move. */
  rejection: string | null;
  /** Honest round-trip in ms, for the connection dot. */
  pingMs: number | null;
}

export interface TableClientOptions {
  def: AnyGameDefinition;
  transport: GameTransport;
  roomId: string;
  playerId: string;
  seat: SeatId | null;
  initial?: Partial<TableState>;
  /** Overridable for tests. */
  now?: () => number;
  makeKey?: () => string;
}

type Listener = (s: TableState) => void;

export class TableClient {
  private def: AnyGameDefinition;
  private transport: GameTransport;
  private roomId: string;
  private playerId: string;
  private handle: TransportHandle | null = null;
  private listeners = new Set<Listener>();
  private now: () => number;
  private makeKey: () => string;
  /** View before the outstanding optimistic move, for rollback. */
  private rollbackView: unknown = null;
  private rollbackLegal: unknown[] = [];
  private inflight = 0;

  state: TableState;

  constructor(opts: TableClientOptions) {
    this.def = opts.def;
    this.transport = opts.transport;
    this.roomId = opts.roomId;
    this.playerId = opts.playerId;
    this.now = opts.now ?? (() => Date.now());
    this.makeKey =
      opts.makeKey ??
      (() =>
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `k${Math.random().toString(36).slice(2)}${this.now()}`);
    this.state = {
      room: null,
      seat: opts.seat,
      view: null,
      legal: [],
      current: [],
      version: 0,
      seq: 0,
      terminal: false,
      scores: null,
      events: [],
      status: "connecting",
      pending: false,
      rejection: null,
      pingMs: null,
      ...opts.initial
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<TableState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  async connect(): Promise<void> {
    this.handle = await this.transport.connect({
      roomId: this.roomId,
      playerId: this.playerId,
      seat: this.state.seat,
      sinceSeq: this.state.seq,
      onMessage: (m) => this.onMessage(m),
      onStatus: (status) => this.set({ status })
    });
  }

  disconnect(): void {
    this.handle?.close();
    this.handle = null;
    this.set({ status: "offline" });
  }

  /** The hot path. Runs synchronously; the network happens afterwards. */
  play(move: unknown): void {
    const seat = this.state.seat;
    if (seat === null) return;

    // 1. Optimistic view — this is what the player sees, immediately.
    this.rollbackView = this.state.view;
    this.rollbackLegal = this.state.legal;
    let optimistic = this.state.view;
    try {
      if (this.def.predict) optimistic = this.def.predict(this.state.view, seat, move);
    } catch {
      optimistic = this.state.view; // a failed prediction just means "wait for truth"
    }
    this.inflight++;
    this.set({ view: optimistic, legal: [], pending: true, rejection: null });

    // 2. Then tell the server.
    const key = this.makeKey();
    const sentAt = this.now();
    void this.send({ type: "move", move, idempotencyKey: key, clientVersion: this.state.version })
      .then(() => {
        this.inflight = Math.max(0, this.inflight - 1);
        this.set({ pending: this.inflight > 0, pingMs: this.now() - sentAt });
      })
      .catch((e: unknown) => {
        this.inflight = Math.max(0, this.inflight - 1);
        this.rollback(e instanceof Error ? e.message : "That move didn't land.");
      });
  }

  private rollback(reason: string): void {
    this.set({
      view: this.rollbackView ?? this.state.view,
      legal: this.rollbackLegal,
      pending: this.inflight > 0,
      rejection: reason
    });
  }

  /** Legal-move lookup used by boards to light affordances. */
  legalMoves(): unknown[] {
    return this.state.legal;
  }

  isMyTurn(): boolean {
    return this.state.seat !== null && this.state.current.includes(this.state.seat);
  }

  send(msg: ClientMessage): Promise<void> {
    return this.transport.send(this.roomId, msg);
  }

  chat(text: string, emote?: string): void {
    void this.send({ type: "chat", text, emote });
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "delta": {
        // Server truth always wins over the local prediction.
        this.rollbackView = null;
        this.set({
          view: msg.view,
          legal: msg.legal,
          current: msg.current,
          version: msg.version,
          seq: Math.max(this.state.seq, msg.seq),
          terminal: msg.terminal,
          events: [...this.state.events, ...msg.events].slice(-200),
          pending: this.inflight > 0
        });
        break;
      }
      case "room":
        this.set({ room: msg.room });
        break;
      case "finished":
        this.set({ terminal: true, scores: msg.scores });
        break;
      case "error":
        this.rollback(msg.message);
        break;
      case "hello":
        this.set({ version: msg.version, seq: Math.max(this.state.seq, msg.seq), status: "live" });
        break;
      case "ping":
        this.set({ status: "live" });
        break;
      default:
        break;
    }
  }
}
