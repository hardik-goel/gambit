/**
 * Everything between "I have a Supabase project" and "here is the link".
 *
 *   1. put the four values in .env.local
 *   2. pnpm go-live
 *
 * It applies the schema, proves the production store actually works against
 * that project, links the Vercel project, pushes the environment, deploys, and
 * prints the URL. Every step is checked before the next one runs, because a
 * half-deployed table is worse than an undeployed one.
 *
 * Nothing here is destructive: re-running it applies only new migrations and
 * overwrites only Gambit's own environment variables.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WEB = join(ROOT, "apps/web");

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL"
] as const;

/** Pushed to Vercel if set, but not required — `public` is the default. */
const OPTIONAL = ["GAMBIT_DB_SCHEMA"] as const;

/** Values that must never leave the server. */
const SERVER_ONLY = ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"];

function loadEnvFile(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [join(ROOT, ".env.local"), join(ROOT, ".env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      out[key!] = raw!.replace(/^["']|["']$/g, "").trim();
    }
  }
  return { ...out, ...process.env } as Record<string, string>;
}

const step = (n: number, text: string): void => console.log(`\n[${n}/6] ${text}`);
const run = (cmd: string, args: string[], cwd = ROOT, env: NodeJS.ProcessEnv = process.env): void => {
  execFileSync(cmd, args, { cwd, stdio: "inherit", env });
};

function main(): void {
  const env = loadEnvFile();
  const missing = REQUIRED.filter((k) => !env[k]);

  if (missing.length) {
    console.error(
      [
        "Missing:",
        ...missing.map((k) => `  ${k}`),
        "",
        "Put them in .env.local at the repository root:",
        "",
        "  NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co     # Settings → API → Project URL",
        "  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ…                    # Settings → API → anon public",
        "  SUPABASE_SERVICE_ROLE_KEY=eyJ…                        # Settings → API → service_role",
        "  DATABASE_URL=postgres://…                             # Settings → Database → URI",
        "",
        ".env.local is git-ignored. The service-role key never reaches the browser."
      ].join("\n")
    );
    process.exit(1);
  }

  // A long random string so the cron endpoint is the scheduler's and nobody
  // else's. Generated once and reused if you already set one.
  const cronSecret =
    env.CRON_SECRET ?? Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");

  const schema = env.GAMBIT_DB_SCHEMA?.trim() || "public";

  step(1, `applying the schema${schema === "public" ? "" : ` into "${schema}"`}`);
  run("pnpm", ["exec", "tsx", "scripts/db-migrate.ts"], ROOT, {
    ...process.env,
    DATABASE_URL: env.DATABASE_URL,
    GAMBIT_DB_SCHEMA: schema
  });

  step(2, "checking the production store against your project");
  // This is also the step that catches an unexposed schema: PostgREST answers
  // "The schema must be one of the following" long before a player would.
  run("pnpm", ["exec", "vitest", "run", "apps/web/lib/server/supabase.test.ts"], ROOT, {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    GAMBIT_DB_SCHEMA: schema
  });

  step(3, "building");
  run("pnpm", ["--filter", "@gambit/web", "build"]);

  step(4, "linking the Vercel project");
  try {
    run("vercel", ["link", "--yes"], WEB);
  } catch {
    console.error(
      "\nCouldn't link non-interactively. Run `cd apps/web && vercel link` once, then re-run this."
    );
    process.exit(1);
  }

  step(5, "pushing the environment");
  const push = [
    ...REQUIRED.filter((k) => k !== "DATABASE_URL"),
    "CRON_SECRET",
    ...OPTIONAL.filter((k) => env[k])
  ];
  for (const key of push) {
    const value = key === "CRON_SECRET" ? cronSecret : env[key]!;
    for (const target of ["production", "preview"]) {
      try {
        execSync(`vercel env rm ${key} ${target} --yes`, { cwd: WEB, stdio: "ignore" });
      } catch {
        // Nothing to remove the first time round.
      }
      const sensitive = SERVER_ONLY.includes(key) ? ["--sensitive"] : [];
      run("vercel", ["env", "add", key, target, "--value", value, "--yes", ...sensitive], WEB);
    }
    console.log(`      ${key} set${SERVER_ONLY.includes(key) ? " (server-only)" : ""}`);
  }

  step(6, "deploying");
  const output = execFileSync("vercel", ["--prod", "--yes"], { cwd: WEB, encoding: "utf8" });
  const url = output.trim().split("\n").filter(Boolean).at(-1);

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`  Gambit is live: ${url}`);
  console.log(`─────────────────────────────────────────────`);
  console.log("\nWorth checking, in this order:");
  console.log("  1. open it, pick a game, press Play here");
  console.log("  2. scan the code from a phone — you should be seated in seconds");
  console.log("  3. make a move on one device and watch it land on the other");
  console.log("     (if it never lands, Realtime isn't connected — check the anon key)");
  console.log(`  4. curl -s -o /dev/null -w '%{http_code}\\n' ${url}/api/cron/sweep   → expect 401`);
}

try {
  main();
} catch (e) {
  console.error(`\nstopped: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
