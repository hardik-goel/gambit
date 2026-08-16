/**
 * Adds Gambit's schema to the project's exposed schemas, via the Management API.
 *
 * The dashboard control for this is the normal way; this exists because that
 * control did not take, and because the setting lives in the platform's own
 * configuration rather than anywhere reachable from the database.
 *
 * It reads, prints what it is about to change, and only ever *adds* — whatever
 * else the project exposes is preserved, which matters when the project belongs
 * to more than one product.
 *
 *   pnpm exec tsx scripts/dev/expose-schema.ts            # show only
 *   pnpm exec tsx scripts/dev/expose-schema.ts --apply    # add it
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://api.supabase.com/v1";

function token(): string {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = join(homedir(), ".supabase/access-token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  throw new Error("no Supabase access token — set SUPABASE_ACCESS_TOKEN or log in with the CLI");
}

function env(key: string): string {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = new RegExp(`^${key}=(.*)$`).exec(line);
    if (match) return match[1]!.trim();
  }
  throw new Error(`${key} is not in .env.local`);
}

async function main(): Promise<void> {
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env("NEXT_PUBLIC_SUPABASE_URL"))?.[1];
  if (!ref) throw new Error("could not read the project ref from NEXT_PUBLIC_SUPABASE_URL");
  const schema = env("GAMBIT_DB_SCHEMA") || "public";
  const auth = { authorization: `Bearer ${token()}`, "content-type": "application/json" };

  const res = await fetch(`${API}/projects/${ref}/postgrest`, { headers: auth });
  if (!res.ok) throw new Error(`reading the config failed: HTTP ${res.status} ${await res.text()}`);
  const config = (await res.json()) as { db_schema: string; db_extra_search_path: string; max_rows: number };

  const exposed = config.db_schema.split(",").map((s) => s.trim()).filter(Boolean);
  console.log(`project ${ref}`);
  console.log(`  exposed now:  ${exposed.join(", ")}`);

  if (exposed.includes(schema)) {
    console.log(`  "${schema}" is already exposed — nothing to do`);
    return;
  }

  const next = [...exposed, schema];
  console.log(`  exposed after: ${next.join(", ")}`);

  if (!process.argv.includes("--apply")) {
    console.log("\nnothing changed. re-run with --apply to make it so.");
    return;
  }

  const patch = await fetch(`${API}/projects/${ref}/postgrest`, {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({
      db_schema: next.join(", "),
      db_extra_search_path: config.db_extra_search_path,
      max_rows: config.max_rows
    })
  });
  if (!patch.ok) throw new Error(`the change was refused: HTTP ${patch.status} ${await patch.text()}`);
  console.log("\napplied. PostgREST restarts in a few seconds.");
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
