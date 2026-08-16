/** Removes anything the store contract left behind in a real project. */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main(): Promise<void> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]!] = match[2]!;
  }
  const schema = env.GAMBIT_DB_SCHEMA || "public";
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const rooms = await db.query(
    `delete from ${schema}.rooms where id::text like '00000000-0000-4000-8000-%'`
  );
  const profiles = await db.query(`delete from ${schema}.profiles where id in ('host', 'bo')`);
  console.log(`removed ${rooms.rowCount} rooms and ${profiles.rowCount} profiles`);
  await db.end();
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
