/**
 * Runs the stale-lobby sweep by hand.
 *
 * Same rule the daily cron applies: a lobby nobody has been near for an hour is
 * marked abandoned. Nothing is deleted.
 */
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) process.env[m[1]!] = m[2]!;
  }
  const { sweepStaleLobbies } = await import("../../apps/web/lib/server/sweep");
  console.log(`closed ${await sweepStaleLobbies()} stale lobbies`);
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
