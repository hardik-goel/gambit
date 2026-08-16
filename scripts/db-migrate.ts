/**
 * Applies `supabase/migrations` to a database, once each.
 *
 *   DATABASE_URL=postgres://… pnpm db:migrate
 *
 * For Supabase, the connection string is under Project settings → Database →
 * Connection string → URI (the pooler one is fine).
 *
 * Every file is recorded in `public.schema_migrations` after it runs, so this
 * is safe to run again — it applies what is new and skips what is not. The same
 * SQL is verified against a throwaway Postgres by `pnpm db:check`.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS = new URL("../supabase/migrations", import.meta.url).pathname;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("set DATABASE_URL to the database you want migrated");
    process.exit(1);
  }

  const db = new Client({
    connectionString: url,
    // Supabase terminates TLS with its own certificate chain.
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? undefined : { rejectUnauthorized: false }
  });
  await db.connect();

  try {
    await db.query(`
      create table if not exists public.schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      );
    `);

    const { rows: applied } = await db.query<{ name: string; checksum: string }>(
      `select name, checksum from public.schema_migrations`
    );
    const seen = new Map(applied.map((r) => [r.name, r.checksum]));

    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let ran = 0;

    for (const name of files) {
      const sql = readFileSync(join(MIGRATIONS, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
      const previous = seen.get(name);

      if (previous === checksum) {
        console.log(`  skip  ${name} (already applied)`);
        continue;
      }
      if (previous && previous !== checksum) {
        // Editing a migration that has already run is how two environments
        // quietly stop matching. Add a new file instead.
        console.error(`  STOP  ${name} has changed since it was applied. Write a new migration instead.`);
        process.exit(1);
      }

      await db.query("begin");
      try {
        await db.query(sql);
        await db.query(`insert into public.schema_migrations (name, checksum) values ($1, $2)`, [
          name,
          checksum
        ]);
        await db.query("commit");
        console.log(`  ok    ${name}`);
        ran++;
      } catch (e) {
        await db.query("rollback");
        throw e;
      }
    }

    console.log(ran === 0 ? "\nnothing to apply — the database is up to date" : `\napplied ${ran}`);
  } finally {
    await db.end().catch(() => undefined);
  }
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
