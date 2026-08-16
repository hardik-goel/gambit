/** What is actually in the database right now. */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main(): Promise<void> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]!] = m[2]!;
  }
  const schema = env.GAMBIT_DB_SCHEMA || "public";
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  for (const table of ["rooms", "room_players", "profiles", "games"]) {
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from ${schema}.${table}`);
    console.log(`${schema}.${table}: ${rows[0]!.n}`);
  }
  const { rows } = await db.query<{ code: string; game_id: string; status: string }>(
    `select code, game_id, status from ${schema}.rooms order by created_at desc limit 3`
  );
  for (const r of rows) console.log(`  ${r.code} ${r.game_id} ${r.status}`);
  await db.end();
}

void main().catch((e: unknown) => { console.error(e); process.exit(1); });
