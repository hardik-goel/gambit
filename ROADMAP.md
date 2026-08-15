# Roadmap

## Shipped

- **Phase A** — platform core, the game SDK and test kit, Chess end to end.
  Rooms, seats, the move pipeline, per-seat redaction, reconnection with event
  replay, bots and timeout takeover, replay theatre, the audio engine, six shell
  themes, the Shelf, share cards, PWA manifest.

## Next

- **Phase B** — Quintet, Mosaic, Facet (teams, drafting, engine building).
- **Phase C** — Boxcar, Hamlet, Stronghold (heavy boards, union-find scoring, dice).
- **Phase D** — Phantom, Motive (asymmetric roles, private reveals, interrupts).
- **Phase E** — Landfall, Remedy (trading subsystem, full co-op).
- **Phase F** — matchmaking, ratings and seasons, eleven tutorials, analytics,
  perf CI, seed content.

## Phase 2 — same-room play with no internet at all

Today "same room" means "same internet room, reached by QR". On home wifi that is
imperceptible, and optimistic play covers the rest. But a browser cannot host a
Bluetooth or Wi-Fi-Direct session, so a table in a car, a train or a power cut
still needs the network.

The fix is a transport swap, not a rewrite, because the authoritative loop is
already a pure function behind two ports:

1. Wrap the app with **Capacitor**.
2. Implement `NearbyTransport` against `GameTransport` — Google **Nearby
   Connections** on Android, **MultipeerConnectivity** on iOS.
3. Run `MemoryRoomStore` + the engine on the **host device**. It is already the
   same code path the dev server uses.
4. Rejoin/reconnect works unchanged: clients resume from their last sequence.

Checklist for that work:

- [ ] Capacitor shell, iOS + Android
- [ ] `NearbyTransport` implementing `connect`/`send`
- [ ] Host election and migration when the host walks out of range
- [ ] Local persistence of the event log so a dropped host can hand over
- [ ] Discovery UI ("tables near you") alongside the QR sheet

## Game #12 checklist

The point of the SDK is that this list is short. See ADDING_A_GAME.md.

- [ ] `packages/games/<id>` with a `GameDefinition`
- [ ] `configSchema` in Zod (the lobby panel generates itself)
- [ ] `redactStateFor` + a leak test for anything hidden
- [ ] `bot` at three levels
- [ ] `Board.tsx` reading `legal` for affordances
- [ ] Two-minute `Tutorial`
- [ ] `audioCues` mapped to existing cue names
- [ ] Test kit: properties, 500 sims, golden replay
- [ ] One line in `CATALOG` + `SHELF_ORDER`
- [ ] A row in LEGAL.md if it is inspired by a commercial title

## Later

- **Tournaments** — brackets and swiss over the existing room primitives; a
  tournament is a scheduler that opens rooms and reads results.
- **Voice rooms** — WebRTC audio per table, push-to-talk, with the same mute and
  block controls as chat.
- **Ranked seasons** — per-game Glicko-lite, placements, leaderboards, a 30s
  spectator delay on ranked tables.
- **Map packs and cosmetics** — the only monetisation seams: premium themes,
  Boxcar map packs, avatar frames, table cosmetics. Never anything that touches
  a rule.
- **Cross-device handoff** — pick a game up on the phone that you started on the
  laptop; the event log already makes this trivial.
