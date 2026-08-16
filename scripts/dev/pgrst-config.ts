/** What PostgREST's own configuration actually says, as stored on the role. */
import { readFileSync } from "node:fs";
import { Client } from "pg";

async function main(): Promise<void> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]!] = match[2]!;
  }
  const db = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const { rows } = await db.query<{ rolname: string; rolconfig: string[] | null }>(
    `select rolname, rolconfig from pg_roles where rolname in ('authenticator','postgres') order by rolname`
  );
  for (const row of rows) {
    console.log(`${row.rolname}:`);
    for (const setting of row.rolconfig ?? []) console.log(`  ${setting}`);
  }
  await db.end();
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
