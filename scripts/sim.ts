/**
 * Bot-versus-bot simulator.
 *
 *   pnpm sim chess --games 500 [--seats 2] [--level 1] [--config '{"clock":"none"}']
 *
 * Every launch game must finish a large batch with zero failures before it can
 * ship: no stuck tables, no illegal bot moves, no broken invariants.
 */
import { simulateMany } from "../packages/sdk/src/testkit/index.js";
import { CATALOG } from "../packages/games/registry/src/index.js";

const args = process.argv.slice(2);
const gameId = args[0];
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

if (!gameId || !CATALOG[gameId]) {
  console.error(`usage: pnpm sim <gameId> [--games N] [--seats N] [--level 1|2|3]`);
  console.error(`known games: ${Object.keys(CATALOG).join(", ") || "(none registered yet)"}`);
  process.exit(1);
}

const def = CATALOG[gameId]!;
const games = Number(flag("games", "200"));
const seats = Number(flag("seats", String(def.meta.minPlayers)));
const level = Number(flag("level", "1")) as 1 | 2 | 3;
const config = flag("config") ? (JSON.parse(flag("config")!) as unknown) : undefined;

console.log(
  `simulating ${games} games of ${def.meta.name} · ${seats} seats · bot level ${level}`
);
const started = Date.now();
const batch = simulateMany(def, games, { seats, level, config, maxPly: 6000 });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n${batch.ok}/${batch.games} completed cleanly in ${elapsed}s`);
console.log(`avg plies ${batch.avgPly.toFixed(1)} · avg ${batch.avgMs.toFixed(0)}ms per game`);
console.log(
  `wins by seat: ${Object.entries(batch.winsBySeat)
    .map(([s, n]) => `#${Number(s) + 1}=${n}`)
    .join("  ") || "none"}`
);

if (batch.failures.length) {
  console.error(`\n${batch.failures.length} failures:`);
  for (const f of batch.failures.slice(0, 10)) {
    console.error(`  seed ${f.seed} @ ply ${f.ply}: ${f.error ?? "did not terminate"}`);
  }
  process.exit(1);
}
