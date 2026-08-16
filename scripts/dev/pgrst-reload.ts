/**
 * Tells PostgREST to re-read its configuration and its schema cache.
 *
 * Changing "Exposed schemas" in the dashboard writes the setting, but the
 * running API only notices on a reload. This is the documented way to ask for
 * one, and it is what the platform itself sends. No downtime: in-flight
 * requests are unaffected, and the cache is rebuilt in the background.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main(): Promise<void> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]!] = match[2]!;
  }
  const db = new Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await db.connect();
  await db.query(`notify pgrst, 'reload config'`);
  await db.query(`notify pgrst, 'reload schema'`);
  await db.end();
  console.log("asked PostgREST to reload its config and schema cache");
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
