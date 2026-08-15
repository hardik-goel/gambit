/**
 * The performance budget, enforced.
 *
 * Two checks, both of which have caught real regressions:
 *
 *   1. First-load JavaScript per route, read from Next's own build report —
 *      the number that decides whether a mid-range Android gets to the felt
 *      inside two and a half seconds.
 *   2. That the shelf never ships a game's rules or map data. Game code is
 *      split per game and loaded when a table opens; if that ever breaks, the
 *      front door quietly doubles in size and nobody notices.
 *
 *   pnpm exec tsx scripts/perf-budget.ts
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const NEXT = join(ROOT, "apps/web/.next");

/** Kilobytes of first-load JavaScript, as Next measures it. */
const BUDGETS: Record<string, number> = {
  "/": 185,
  "/r/[code]": 240,
  "/learn/[gameId]": 240,
  "/replay/[code]": 240
};

console.log("building…");
const output = execSync("pnpm --filter @gambit/web build", {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
});

// Lines look like:  ┌ ○ /                          2.24 kB         168 kB
const rows: { route: string; firstLoad: number }[] = [];
for (const line of output.split("\n")) {
  const match = /^[┌├└]\s+[○ƒλ●]\s+(\S+)\s+[\d.]+\s*[kM]?B\s+([\d.]+)\s*kB/.exec(line.trim());
  if (!match) continue;
  const [, route, kb] = match;
  if (route!.startsWith("/api")) continue;
  rows.push({ route: route!, firstLoad: Number(kb) });
}

if (rows.length === 0) {
  console.error("could not read the build report — has the output format changed?");
  process.exit(1);
}

let failed = false;
for (const row of rows.sort((a, b) => b.firstLoad - a.firstLoad)) {
  const budget = BUDGETS[row.route];
  const over = budget !== undefined && row.firstLoad > budget;
  if (over) failed = true;
  console.log(
    `${over ? "OVER " : "ok   "} ${String(row.firstLoad).padStart(6)}kB  ${row.route}${
      budget ? `  (budget ${budget}kB)` : ""
    }`
  );
}

/* ---- the shelf must not carry a single game's data ---- */

interface Manifest {
  pages: Record<string, string[]>;
}
const manifest = JSON.parse(readFileSync(join(NEXT, "app-build-manifest.json"), "utf8")) as Manifest;
const shelfChunks = (manifest.pages["/page"] ?? []).filter((f) => f.endsWith(".js"));
const needles = ["Bhubaneswar", "Winter Garden", "Halcyon", "Duelling Pistol", "Thornreef"];

const leaks: string[] = [];
for (const chunk of shelfChunks) {
  let source = "";
  try {
    source = readFileSync(join(NEXT, chunk), "utf8");
  } catch {
    continue;
  }
  for (const needle of needles) {
    if (source.includes(needle)) leaks.push(`${needle} in ${chunk}`);
  }
}

const shelfBytes = shelfChunks.reduce((n, f) => {
  try {
    return n + statSync(join(NEXT, f)).size;
  } catch {
    return n;
  }
}, 0);
console.log(`\nshelf route pulls ${shelfChunks.length} chunks, ${Math.round(shelfBytes / 1024)}kB raw`);

if (leaks.length) {
  failed = true;
  console.error(`\nthe shelf is carrying game data it does not need:\n  ${leaks.join("\n  ")}`);
  console.error("check that no client component imports @gambit/games directly.");
}

console.log(failed ? "\nperformance budget exceeded" : "\nperformance budget met");
if (failed) process.exit(1);
