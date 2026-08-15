# Credits

## Sound

Every sound effect in Gambit is **synthesised at runtime** by
`packages/ui/src/audio.ts` from oscillators and filtered white noise. There is no
sample pack, no sound library, and nothing to license — the cue table is source
code, authored for this project.

The six music beds are generated the same way: a scale, a tempo and a voicing per
theme, walked by a deterministic pattern. They are original compositions in the
only sense that matters here — nobody else wrote them, and they exist nowhere but
in this repository.

Players can add their own audio files. Those are played from a local object URL,
never uploaded, never stored, never transmitted.

## Type

The interface uses the reader's system serif stack (Georgia, Iowan Old Style,
Times New Roman) — no bundled or hosted font, and so no font licence.

## Code

| Dependency | Licence | Why it's here |
|---|---|---|
| Next.js | MIT | app framework |
| React | MIT | UI |
| Framer Motion | MIT | spring physics and layout animation |
| Zod | MIT | config schemas, which generate the lobby panels |
| Zustand | MIT | client state |
| qrcode | MIT | the "play here" code |
| Tailwind CSS | MIT | utility layer |
| Supabase JS | MIT | production store and realtime transport |
| Vitest / tsx / TypeScript | MIT / Apache-2.0 | build and test |

## Art

All board, tile, card and map artwork in Gambit is authored for Gambit. Where a
game is inspired by a commercial title, see `LEGAL.md` for the line we hold.

The knight-with-a-rail-switch mark is drawn as an SVG path in
`packages/ui/src/brand.ts`.

## Chess

The rules of chess are public domain. The piece glyphs are the Unicode chess
characters (U+2654–U+265F), which are part of the character set, not an asset.
