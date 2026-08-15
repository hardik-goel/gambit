/**
 * CI's simulation gate: every installed game, at both ends of its seat range,
 * must finish a batch of bot-versus-bot games cleanly.
 */
import { simulateMany } from "../packages/sdk/src/testkit/index";
import { CATALOG, GAME_IDS } from "../packages/games/registry/src/index";

/**
 * The gate runs sixty games per game per seat count. That is enough to catch a
 * table that cannot finish — which is exactly what it caught for Boxcar at five
 * seats and Landfall at three. A deeper sweep of one game is a separate command:
 *   pnpm sim <id> --games 500
 */
const GAMES = Number(process.env.SIM_GAMES ?? 60);
let failed = false;

for (const id of GAME_IDS) {
  const def = CATALOG[id]!;
  const seatCounts = new Set([def.meta.minPlayers, def.meta.maxPlayers]);
  for (const seats of seatCounts) {
    const started = Date.now();
    const batch = simulateMany(def, GAMES, { seats, level: 1, maxPly: 6000 });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const line = `${def.meta.name} · ${seats} seats · ${batch.ok}/${batch.games} in ${secs}s · avg ${batch.avgPly.toFixed(0)} plies`;

    if (batch.failures.length) {
      failed = true;
      console.error(`FAIL  ${line}`);
      for (const f of batch.failures.slice(0, 5)) {
        console.error(`        seed ${f.seed} @ ply ${f.ply}: ${f.error ?? "did not terminate"}`);
      }
    } else {
      console.log(`ok    ${line}`);
    }
  }
}

if (failed) process.exit(1);
console.log("\nall games simulate cleanly");
